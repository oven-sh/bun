export const meta = {
  name: "clippy-fix-round",
  description: "Per-file clippy fixer with 2-reviewer adversarial gate",
  phases: [
    { title: "Fix", detail: "one read-only agent per file produces a unified diff" },
    { title: "Review", detail: "2 adversarial reviewers per diff; both must approve" },
  ],
};

// args: Array<{file, count, diagPath}>  (or {files: [...]}, or a JSON string of either)
const parsed = typeof args === "string" ? JSON.parse(args) : args;
const files = Array.isArray(parsed) ? parsed : parsed.files;
if (!Array.isArray(files)) throw new Error("args must be an array of {file,count,diagPath}");
log(`round: ${files.length} files`);

const PATCH_SCHEMA = {
  type: "object",
  required: ["patch", "summary"],
  properties: {
    patch: {
      type: "string",
      description:
        "Unified diff (git apply compatible) against the repo root. Must use 'a/<path>' and 'b/<path>' headers and at least 3 lines of context. Empty string if no safe fix is possible.",
    },
    summary: { type: "string", description: "One line per lint addressed, or why a lint was left alone." },
    skipped: {
      type: "array",
      items: { type: "string" },
      description: "Lint codes intentionally not fixed and why (one entry each).",
    },
  },
  additionalProperties: false,
};

const REVIEW_SCHEMA = {
  type: "object",
  required: ["approved", "notes"],
  properties: {
    approved: { type: "boolean" },
    notes: { type: "string", description: "Concrete defects found, or 'ok'. Be specific: line, what's wrong, why." },
    revisedPatch: {
      type: "string",
      description:
        "Optional: a corrected unified diff if the original had a fixable defect. Same format rules as the fixer. Omit if approved or if the only correct action is to drop the patch.",
    },
  },
  additionalProperties: false,
};

const FIXER_RULES = `
HARD CONSTRAINTS — violating any of these means your output is discarded:
- You may use ONLY the Read and Grep tools. You are FORBIDDEN from using Bash, Edit, Write, git, cargo, or any tool that mutates state. Do not build, do not run tests.
- Return your change ONLY as a unified diff in the structured output. Do not apply it.
- The diff MUST apply cleanly with \`git apply\` (strict, then \`--recount\` fallback) from repo root: headers \`--- a/<path>\` / \`+++ b/<path>\`, @@ hunks with ≥3 context lines per hunk, exact whitespace, LF line endings.
- The PRIMARY file is the one you were assigned. You MAY include hunks for OTHER files **only** when a signature you changed in the primary file has callers there (found via Grep). Never refactor unrelated code in other files.
- **NEVER add \`#[allow(...)]\`, \`#[expect(...)]\`, or any lint-silencing attribute. Fix the underlying code.** If a lint genuinely cannot be fixed without breaking semantics, return it in \`skipped\` with a one-sentence reason — the loop driver will escalate it; do not silence it.
- NEVER weaken behavior to satisfy a lint (no dropping a \`mem::forget\` without an equivalent ownership transfer; no deleting a \`drop()\` that has side effects; no changing eager→lazy eval where the eager value has observable side effects).
- NEVER add comments other than \`// SAFETY:\` justifications.
- Prefer the smallest correct diff. Do not reformat unrelated lines.

LINT-SPECIFIC GUIDANCE:
- undocumented_unsafe_blocks: add \`// SAFETY: <invariant>\` immediately above the \`unsafe {\`. State the invariant the surrounding code guarantees, not a restatement of the operation. Read enough context to be specific.
- mem_forget: convert to the structural equivalent — \`ManuallyDrop::new\` + later \`ManuallyDrop::into_inner\`/\`drop\`, or \`Box::into_raw\`/\`Arc::into_raw\`/\`Vec::into_raw_parts\` for FFI handoff, or \`Box::leak\`/\`&'static\` for process-lifetime. Preserve the exact ownership semantics.
- not_unsafe_ptr_arg_deref: mark the fn \`unsafe\` (or \`unsafe extern "C"\`). Grep for every Rust call site (\`rg 'fn_name\\('\` under \`src/\`) and wrap each in \`unsafe { ... }\` with a \`// SAFETY:\` comment in those files. C/C++ callers via \`#[no_mangle]\` need no change. If the pointer is never null/dangling by construction, prefer changing the param type to \`NonNull<T>\` or \`&T\`/\`&mut T\` instead — that fixes the lint without making the fn unsafe.
- trivially_copy_pass_by_ref: change \`&T\` → \`T\`. Grep for callers; change \`f(&x)\` → \`f(x)\` (or \`f(*x)\` if \`x\` is itself a ref). Trait impls: only if the trait def is in this repo and you update it + all impls.
- needless_pass_by_value: change \`T\` → \`&T\` (or \`&str\`/\`&[_]\` for owned string/vec). Grep for callers; add \`&\`. Skip ONLY if the body moves out of the value or stores it (intentional sink) — note in \`skipped\` with the line that consumes it.
- large_types_passed_by_value: change \`T\` → \`&T\`; update callers. If the fn must own it (stores into self, returns it), \`Box<T>\` instead.
- mut_from_ref: change the backing storage to \`UnsafeCell<T>\` (or the existing \`bun_ptr::Cell\` if available) and return \`unsafe { &mut *cell.get() }\` with a \`// SAFETY:\` stating the no-alias invariant. Update field access sites in the same file. If the field lives in another file, include that hunk.
- cast_ptr_alignment: if the source buffer may be unaligned, use \`ptr.cast::<T>()\` + \`read_unaligned()\`/\`write_unaligned()\` (or \`core::ptr::copy_nonoverlapping\` to a stack \`MaybeUninit<T>\`). If alignment is guaranteed, keep the cast and add the guarantee to the enclosing \`// SAFETY:\`.
- or_fun_call: \`.unwrap_or(expr)\` → \`.unwrap_or_else(|| expr)\` etc. ONLY when \`expr\` allocates/computes; if \`expr\` is a const/literal/cheap-copy, this is a false positive — note in \`skipped\`.
- assigning_clones: \`*a = b.clone()\` → \`a.clone_from(&b)\` (or \`a.clone_from(b)\` if \`b\` is already a ref).
- unnecessary_unwrap: rewrite to \`if let\`/\`match\`/\`?\` per clippy's suggestion.
- clone_on_ref_ptr: \`x.clone()\` → \`Arc::clone(&x)\` / \`Rc::clone(&x)\`.
- derive_partial_eq_without_eq: add \`Eq\` to the derive **only if** every field type is \`Eq\` (no \`f32\`/\`f64\`). Otherwise skip — the lint is a false positive there.
- derivable_impls / vec_init_then_push / implicit_clone / map_clone / iter_overeager_cloned / ptr_as_ptr / ref_as_ptr / borrow_as_ptr / ptr_cast_constness / if_same_then_else / drop_non_drop: apply clippy's suggested rewrite.
- disallowed_types / disallowed_methods / disallowed_macros: replace with the \`bun_*\` equivalent named in the lint reason (e.g. \`std::sync::Mutex\` → \`bun_threading::Mutex\`, \`std::fs::read\` → \`bun_sys::file::read\`, \`println!\` → \`bun_core::output::println\`). Add the \`use\` import. If the bun_* API has a different signature, adapt the call. If the file IS the bun_* wrapper itself (e.g. \`bun_sys\`, \`bun_threading\`, \`bun_core::output\`), the std use is the implementation — skip and note.
- large_enum_variant: \`Box<BigArm>\` the large variant; update every construction and pattern-match site (Grep for the variant name).
- large_stack_frames: move the large local to \`Box::new\` / heap; if it's a fixed-size scratch buffer in a hot loop, switch to a reused field or \`SmallVec\` instead.
- useless_attribute / absurd_extreme_comparisons: delete the attribute / dead branch.
- todo / unimplemented: Grep for the function's callers. If unreachable in practice, replace with \`unreachable!()\` + a SAFETY-style comment. Otherwise skip and note — implementing missing functionality is out of scope.
- dbg_macro: delete the \`dbg!()\` (keep its inner expression if its value is used).
- clone_on_copy / useless_conversion / manual_swap / mem_replace_option_with_none / redundant_locals / manual_c_str_literals / precedence / implicit_saturating_sub / ptr_eq / vec_box / boxed_local: apply clippy's suggested rewrite.
- arc_with_non_send_sync: change \`Arc<T>\` → \`Rc<T>\` if the value never crosses threads (Grep for cross-thread sends); otherwise make \`T: Send + Sync\` (or wrap the non-Sync field in a Mutex).
- dead_code (fn/method/type/static/const/variant/field never used): DELETE it. First Grep for the name across \`src/\` to confirm zero references (sometimes used via macro/FFI symbol name). If it's \`#[no_mangle]\`/\`extern\` or referenced by a \`.classes.ts\`/codegen script, keep it and note in \`skipped\` (FFI export). For a never-read field, prefix with \`_\` if the struct is FFI-layout-pinned (\`#[repr(C)]\`), else delete the field + update constructors.
- unused_imports: delete the import (or just the unused names from a \`use {a, b, c}\` group).
- unused_variables / unused_mut: prefix with \`_\` if the binding is required (pattern match, FFI signature), else delete the binding.
- unused_assignments: delete the dead write; if it documents a state transition, note in \`skipped\`.
- unused_macros: delete the macro definition.
- unreachable_code / unreachable_patterns: delete the unreachable arm/statement. If it's a \`#[cfg]\`-gated fallthrough that's reachable on another platform, wrap it in the matching \`#[cfg]\` instead.
- non_snake_case / non_camel_case_types / non_upper_case_globals: rename to the conventional case AND update all references (Grep). If the name is FFI-pinned (\`#[no_mangle]\`, matches a C++ symbol, or appears in a \`.classes.ts\`/\`.bind.ts\`), keep the name and note in \`skipped\`.
`;

const REVIEWER_RULES = `
You are an ADVERSARIAL reviewer. Default stance: REJECT. Approve only if you cannot find a defect.
You may use ONLY Read and Grep. No Bash, no cargo, no git, no Edit/Write.

REJECT if ANY of:
- The diff would not compile (type mismatch, missing import, signature change with a caller — Grep for it — left un-updated).
- The diff changes behavior (a dropped mem::forget that now double-frees; a fn made \`unsafe\` while a safe Rust caller exists un-wrapped; eager→lazy eval where the eager expr had side effects; \`Eq\` added to a type with float fields).
- The diff adds ANY \`#[allow(...)]\` / \`#[expect(...)]\` attribute. **These are forbidden.** Reject.
- The diff touches files other than the primary file for any reason OTHER than updating direct callers of a changed signature.
- A SAFETY comment is vacuous ("SAFETY: this is safe", "SAFETY: trust me") or factually wrong about the invariant.
- A \`disallowed_*\` replacement is applied inside the wrapper crate that legitimately implements it (\`bun_sys\`, \`bun_threading\`, \`bun_core::output\`, \`bun_collections\`).
- Unified-diff format is malformed: missing \`--- a/\` or \`+++ b/\` headers, hunks with <3 context lines, or context lines that don't match the file. **Do NOT reject solely on @@ line-count arithmetic** — the apply step uses \`git apply --recount\`, which recomputes counts from the body. Only reject if the hunk BODY itself is wrong (context mismatch, missing lines, tabs↔spaces drift).

If you reject for a FIXABLE reason (typo, missing import, off-by-one context), provide \`revisedPatch\` with the corrected diff.
If you reject because the change is unsound or the lint should be skipped, leave \`revisedPatch\` empty.

Be terse. \`notes\` is for the apply step, not a human.
`;

const results = await pipeline(
  files,
  // ---- Fix ----
  f =>
    agent(
      `Fix the clippy errors in \`${f.file}\` (Bun repo at /root/bun-5).\n\n` +
        `There are ${f.count} diagnostics.\n` +
        `FIRST: Read the full diagnostic dump at \`${f.diagPath}\` — it has every rendered error with line/col.\n` +
        `THEN: Read \`/root/bun-5/${f.file}\` and produce the diff.\n` +
        `For \`disallowed_*\` replacements, the bun_* API conventions are documented in \`/root/bun-5/src/CLAUDE.md\` — Read it if you need the exact signature.\n\n` +
        FIXER_RULES,
      { label: `fix:${f.file}`, phase: "Fix", schema: PATCH_SCHEMA },
    ),
  // ---- Review (2 adversarial, parallel) ----
  async (fix, f) => {
    if (!fix || !fix.patch?.trim()) {
      return { file: f.file, approved: false, patch: "", reviewNotes: fix?.summary ?? "fixer produced no patch" };
    }
    const reviewPrompt =
      `Adversarially review this clippy-fix diff for \`${f.file}\` (Bun repo at /root/bun-5).\n\n` +
      `The ${f.count} original diagnostics are at \`${f.diagPath}\` — Read that first.\n` +
      `The current file is at \`/root/bun-5/${f.file}\` — Read the relevant regions.\n\n` +
      `Proposed diff:\n\`\`\`diff\n${fix.patch}\n\`\`\`\n\n` +
      `Fixer's summary: ${fix.summary}\n\n` +
      REVIEWER_RULES;
    const [r1, r2] = await parallel([
      () => agent(reviewPrompt, { label: `rev1:${f.file}`, phase: "Review", schema: REVIEW_SCHEMA }),
      () => agent(reviewPrompt, { label: `rev2:${f.file}`, phase: "Review", schema: REVIEW_SCHEMA }),
    ]);
    const v1 = r1 ?? { approved: false, notes: "reviewer1 failed" };
    const v2 = r2 ?? { approved: false, notes: "reviewer2 failed" };
    // Both approve → ship fixer's patch.
    if (v1.approved && v2.approved) {
      return { file: f.file, approved: true, patch: fix.patch, reviewNotes: "2/2 approved" };
    }
    // One reviewer offered a revision and the other approved the original →
    // be conservative: drop (revisions aren't cross-reviewed this round).
    // Both reject → drop.
    const notes = [
      v1.approved ? "r1:ok" : `r1:REJECT ${v1.notes}`,
      v2.approved ? "r2:ok" : `r2:REJECT ${v2.notes}`,
    ].join(" | ");
    return { file: f.file, approved: false, patch: "", reviewNotes: notes };
  },
);

return results.filter(Boolean);
