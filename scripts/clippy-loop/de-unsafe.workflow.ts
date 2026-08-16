export const meta = {
  name: "de-unsafe-pass",
  description: "Convert pub unsafe fn(*mut T) → pub fn(&mut T) / NonNull<T>",
  phases: [
    { title: "Refactor", detail: "agent removes unsafe markers, changes ptr→ref" },
    { title: "Review", detail: "1 adversarial reviewer" },
  ],
};

const parsed = typeof args === "string" ? JSON.parse(args) : args;
const files = Array.isArray(parsed) ? parsed : parsed.files;
if (!Array.isArray(files)) throw new Error("args must yield an array of {file,count}");

const RESULT_SCHEMA = {
  type: "object",
  required: ["status", "summary", "callerEdits"],
  properties: {
    status: { type: "string", enum: ["fixed", "skipped", "partial"] },
    summary: { type: "string" },
    callerEdits: {
      type: "array",
      items: { type: "string" },
      description: "Files OUTSIDE this one that were edited (caller updates).",
    },
  },
  additionalProperties: false,
};

const REVIEW_SCHEMA = {
  type: "object",
  required: ["verdict", "notes"],
  properties: {
    verdict: { type: "string", enum: ["ok", "revert", "fix-needed"] },
    notes: { type: "string" },
  },
  additionalProperties: false,
};

const FIXER = `
You are converting \`pub unsafe fn\` back to safe \`pub fn\` by changing raw-pointer params to references in /root/bun-5.

This PR over-applied "mark unsafe fn" to fix \`clippy::not_unsafe_ptr_arg_deref\`. The right fix is to change the param TYPE so the lint never fires. Find every \`pub unsafe fn\` in your assigned file (Grep \`^.*pub unsafe fn\` with line numbers, then Read the context). For each:

1. **Skip if it was already \`unsafe\` on main** — only convert ones this PR added. Check: does the fn have a \`/// # Safety\` doc that was clearly machine-generated (e.g. "...must be a live pointer...", "...caller guarantees..."), and does the body have an \`unsafe { (*p).field }\` pattern? Those are the new ones. Genuine FFI \`extern "C"\`/\`#[no_mangle]\` fns that were ALREADY unsafe on main: skip.

2. **\`pub unsafe fn foo(p: *mut T, ...)\` where the body just dereferences \`p\`:**
   - Change to \`pub fn foo(p: &mut T, ...)\` (or \`&T\` if only reads).
   - Delete the \`/// # Safety\` doc.
   - In the body: \`unsafe { (*p).x }\` → \`p.x\`, \`unsafe { (*p).method() }\` → \`p.method()\`.
   - If the body STORES \`p\` for later (assigns to a struct field, passes to a registry), use \`NonNull<T>\` instead of \`&mut T\` (lifetime won't work).
   - Update IN-FILE callers: \`unsafe { foo(ptr) }\` → \`foo(unsafe { &mut *ptr })\` if they hold a raw ptr; \`foo(x)\` if they hold a ref. Delete the now-redundant outer \`unsafe { }\`.
   - Use Grep to find OUT-OF-FILE callers (\`Grep "fn_name\\(" --type rust\`). Edit those files too, listing them in \`callerEdits\`.

3. **\`pub unsafe extern "C" fn\` / \`#[no_mangle]\` (called from C++):**
   - Keep the \`*mut T\` signature (C ABI). Keep \`unsafe extern "C"\`.
   - At the top of the body, convert once: \`let this = unsafe { &mut *this };  // SAFETY: C++ never passes null for <param>\` and use \`this\` (a reference) for the rest.
   - Delete any \`if this.is_null() { return ... }\` that follows — once you have \`&mut T\` it's unreachable.
   - JSC types (JSCell, JSGlobalObject, CallFrame, JSObject, JSValue ptrs) are NEVER null from C++. Same for opaque handle types passed by-value-pointer.

4. **\`*mut T\` arg used as opaque token / not dereferenced** (passed straight through to another FFI call): leave as \`*mut T\`, drop the \`unsafe\` marker, the lint shouldn't fire.

HARD RULES:
- Use ONLY Read, Grep, Edit. NEVER Bash, cargo, git, Write.
- You MAY edit other files (callers) — list them in \`callerEdits\`.
- Do NOT add \`#[allow(...)]\`.
- Keep \`// SAFETY:\` comments that describe a GENUINE invariant (e.g. "C++ never passes null"). Delete vacuous ones.
`;

const REVIEWER = `
Adversarially review. Use ONLY Read and Grep. No Bash/cargo/git/Edit.

Verify:
- Each \`pub unsafe fn\` either: (a) became \`pub fn(&T)\` with no inner \`unsafe { (*p) }\`, (b) stayed \`unsafe extern "C"\` (C++ caller) with a top-of-body \`let x = unsafe { &mut *p };\`, (c) was already unsafe on main (skip).
- No deleted null check that was actually load-bearing (Grep for the C++ caller — does it ever pass nullptr? If yes the check stays).
- All in-file and out-of-file callers updated. Grep the fn name. Any \`unsafe { fn_name(\` or \`fn_name(raw_ptr)\` left where the sig now wants \`&T\` is a "fix-needed".
- No use-after-free introduced (the \`&mut T\` lifetime must not outlive the original \`*mut T\`'s validity).

verdict: "ok" / "revert" (broke compilation or introduced UAF) / "fix-needed" (callers missed).
`;

const results = await pipeline(
  files,
  f =>
    agent(`Convert \`pub unsafe fn\` → \`pub fn(&T)\` in \`/root/bun-5/${f.file}\` (${f.count} fns).\n\n` + FIXER, {
      label: `de-unsafe:${f.file}`,
      phase: "Refactor",
      schema: RESULT_SCHEMA,
    }),
  async (edit, f) => {
    if (!edit) return { file: f.file, verdict: "skipped", notes: "fixer failed", callerEdits: [] };
    const review = await agent(
      `Review the de-unsafe refactor of \`/root/bun-5/${f.file}\`.\n` +
        `Fixer's summary: ${edit.summary}\n` +
        `Caller files also edited: ${edit.callerEdits.join(", ") || "(none)"}\n\n` +
        REVIEWER,
      { label: `rev:${f.file}`, phase: "Review", schema: REVIEW_SCHEMA },
    );
    return {
      file: f.file,
      verdict: review?.verdict ?? "skipped",
      notes: review?.notes ?? "",
      callerEdits: edit.callerEdits,
    };
  },
);

return results.filter(Boolean);
