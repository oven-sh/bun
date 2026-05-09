export const meta = {
  name: "phase-h-windows-testfix",
  description:
    "Windows test-fix swarm. Reads pre-collected results JSON → shard failing tests → read-only fix-agents (NO build/git/test) → 2-vote adversarial review → orchestrator commits.",
  phases: [
    { title: "Shard", detail: "load results JSON, group failures by signature" },
    { title: "Fix", detail: "one agent per failure-signature: read code+.zig spec, edit only" },
    { title: "Review", detail: "2-vote adversarial review of each fix" },
    { title: "Apply", detail: "orchestrator commits accepted fixes" },
  ],
};

const A = typeof args === "string" ? JSON.parse(args) : args || {};
const REPO = A.repo || "C:\\Users\\dylan\\code\\bun";
const RESULTS = A.results; // path to results JSON written by runner.node.mjs --results-json
const INCLUDE = A.include || ""; // substring filter on testPath (e.g. "js/bun/util")
const MAX_SIGS = A.max_sigs || 16; // cap per round so 16 fix-agents fit the concurrency limit
if (!RESULTS) throw new Error("args.results required (path to runner.node.mjs --results-json output)");

const SHARD_S = {
  type: "object",
  properties: {
    sigs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sig: { type: "string" },
          count: { type: "number" },
          example_test: { type: "string" },
          stdoutPreview: { type: "string" },
          likely_files: { type: "array", items: { type: "string" } },
        },
        required: ["sig", "count", "example_test"],
      },
    },
    total_failed: { type: "number" },
  },
  required: ["sigs", "total_failed"],
};
const FIX_S = {
  type: "object",
  properties: {
    sig: { type: "string" },
    files_edited: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low", "skip"] },
  },
  required: ["sig", "files_edited", "summary", "confidence"],
};
const REVIEW_S = {
  type: "object",
  properties: {
    accept: { type: "boolean" },
    bugs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string" },
          what: { type: "string" },
          why_wrong: { type: "string" },
          severity: { type: "string", enum: ["ub", "leak", "semantics", "abi", "style"] },
        },
        required: ["what", "why_wrong", "severity"],
      },
    },
  },
  required: ["accept", "bugs"],
};

const NO_TOOLS = `**HARD RULES:** Work ONLY in ${REPO}. **DO NOT** run \`bun bd\`/\`bun test\`/\`cargo build\`/\`cargo check\`/\`ninja\`. **DO NOT** run \`git\` (commit/push/reset/checkout/stash/pull). Read/Grep/Glob/Edit OK. The .zig file at the same path as the .rs is the SPEC — match it exactly. If you can't fix confidently, return confidence:"skip".`;

const KNOWN_CLASSES = `**Known Windows bug classes (recent native-run findings):**
1. **SysV-vs-Win64 ABI**: \`#[unsafe(no_mangle)] extern "C" fn\` taking \`&JSGlobalObject\`/\`&CallFrame\` where C++ side declares \`SYSV_ABI\`/\`JSC_CALLCONV\` — wrap in \`bun_jsc::jsc_host_abi! { unsafe fn ... }\`.
2. **Fd kind dispatch**: \`sys_uv::*\` called with system-kind (HANDLE) Fd → \`.uv()\` panics. Spec usually kind-dispatches or uses Win32 directly.
3. **\`Box<uv::Handle>\` auto-drop**: Zig \`*uv.X\` has no drop; Rust \`Box<uv::X>\` drops while async \`uv_close\` callback pending → UAF/double-free.
4. **NTSTATUS→errno**: must use \`translate_ntstatus_to_errno\` table, NOT \`RtlNtStatusToDosError\` chain.
5. **\`cfg(windows)\` arm desync**: signature changed in one cfg arm but not the other.
6. **Stub returning sentinel**: \`TODO(b2-windows)\` stubs returning null/0/\`&[]\` where Zig has a real impl.
7. **WCHAR NUL**: buffer-size in chars-vs-bytes; missing NUL terminator on \`&[u16]\` to W-suffix API.`;

phase("Shard");
const shard = await agent(
  `Load + group Windows test failures by signature. Repo ${REPO}.

1. Read \`${RESULTS}\` (JSON array of {testPath, ok, status, error, exitCode, stdoutPreview, ...}).
2. Filter to \`ok === false\`${INCLUDE ? ` AND testPath includes "${INCLUDE}"` : ""}.
3. Group by **failure signature** — derive a stable key from the FIRST distinctive line of \`error\` or \`stdoutPreview\`:
   - panic: file.rs:line:col
   - "Segmentation fault at address" → top non-handler stack frame address (or "segfault" if no addrs)
   - "thread panicked at" → file:line
   - test assertion → first \`expect(...).toBe\` line
   - else: first 80 chars of error
4. For each group: pick one example_test, capture its stdoutPreview, and list likely_files (grep the file:line from the sig in src/ if it's a .rs path, or guess from the test area: js/bun/http→runtime/api/server, js/node/fs→runtime/node/node_fs, etc.).
5. Sort by count descending. Cap at ${MAX_SIGS}.

${NO_TOOLS}

Return {sigs:[{sig,count,example_test,stdoutPreview,likely_files}], total_failed}.`,
  { label: "shard", phase: "Shard", schema: SHARD_S },
);
if (!shard || !shard.sigs.length) return { error: "no failures to shard", total_failed: shard?.total_failed || 0 };
log(`${shard.total_failed} failed → ${shard.sigs.length} signatures`);

phase("Fix");
const fixed = await pipeline(
  shard.sigs,
  s =>
    agent(
      `Fix Windows test failure (signature seen in ${s.count} tests). Repo ${REPO}.

**Signature:** \`${s.sig}\`
**Example test:** \`test/${s.example_test}\`
**Stdout/stderr (last 4k):**
\`\`\`
${(s.stdoutPreview || "").slice(-3000)}
\`\`\`
**Likely source files:** ${(s.likely_files || []).join(", ") || "(unknown — investigate)"}

${KNOWN_CLASSES}

**Process:**
1. Read the example test to understand what API it exercises.
2. Find the crashing/failing Rust code: if sig has \`file.rs:line\`, start there. Else trace from the test's API surface (e.g. test uses \`Bun.spawn\` → \`src/runtime/api/bun/spawn/\`). Read the .zig sibling for spec.
3. Identify which bug class (above) applies, or root-cause from first principles.
4. Edit the .rs file(s) to match the .zig spec. **NO** \`#[cfg(any())]\`/\`todo!()\`. NEW \`unsafe\` only if FFI-adjacent + \`// SAFETY:\` comment.
5. If the fix touches >3 files or requires architectural change, return confidence:"skip" with summary explaining what's needed.

${NO_TOOLS}

Return {sig:"${s.sig.replace(/"/g, '\\"')}", files_edited:[...], summary:"what+why", confidence}.`,
      { label: `fix:${s.sig.slice(0, 40)}`, phase: "Fix", schema: FIX_S },
    ),
  (fix, s) =>
    fix && fix.confidence !== "skip" && fix.files_edited && fix.files_edited.length > 0
      ? parallel(
          [0, 1].map(
            i => () =>
              agent(
                `Adversarially review Windows test-fix. Repo ${REPO}. DEFAULT accept:true if no bugs.

**Sig:** \`${s.sig}\`
**Fix summary:** ${fix.summary}
**Files edited:** ${fix.files_edited.join(", ")}

**For each edited file:** \`git diff -- <file>\` + read full file + read .zig spec at same path. Check ONLY the changed regions:
1. **ABI**: if it added/changed \`extern "C"\`/\`"sysv64"\`, does the C++ decl (grep symbol in src/jsc/bindings/) actually use SYSV_ABI/JSC_CALLCONV? Wrong-direction ABI fix is worse than no fix.
2. **UB**: aliased \`&mut\` re-entrancy? \`mem::zeroed\` on niche type? Stacked-Borrows violation?
3. **Semantics**: diverges from .zig spec? Windows behavior wrong (HANDLE/DWORD/NTSTATUS)?
4. **Regression**: breaks the non-Windows arm? (check #[cfg] gating)

${NO_TOOLS} (use \`git diff\` ONLY for reading the diff — no other git)

Return {accept, bugs:[{file,what,why_wrong,severity}]}.`,
                { label: `rev${i}:${s.sig.slice(0, 30)}`, phase: "Review", schema: REVIEW_S },
              ),
          ),
        ).then(votes => {
          const v = (votes || []).filter(Boolean);
          const blocking = v.flatMap(r =>
            (r.bugs || []).filter(b => ["ub", "leak", "semantics", "abi"].includes(b.severity)),
          );
          const accepted = v.length >= 2 && v.every(r => r.accept) && blocking.length === 0;
          return { ...fix, sig: s.sig, count: s.count, accepted, blocking };
        })
      : { ...fix, sig: s.sig, count: s.count, accepted: false, blocking: [] },
);

const accepted = fixed.filter(f => f && f.accepted);
const skipped = fixed.filter(f => f && (f.confidence === "skip" || !f.files_edited?.length));
const rejected = fixed.filter(f => f && !f.accepted && f.confidence !== "skip" && f.files_edited?.length);

return {
  include: INCLUDE,
  total_failed: shard.total_failed,
  sigs: shard.sigs.length,
  accepted: accepted.map(f => ({ sig: f.sig, count: f.count, files: f.files_edited, summary: f.summary })),
  rejected: rejected.map(f => ({ sig: f.sig, files: f.files_edited, blocking: f.blocking, summary: f.summary })),
  skipped: skipped.map(f => ({ sig: f.sig, summary: f.summary })),
  files_touched: [...new Set(accepted.flatMap(f => f.files_edited))],
};
