export const meta = {
  name: "phase-h-windows-testfix",
  description:
    "Windows test-fix swarm. Reads pre-collected results JSON → shard → fix-agent per sig in ISOLATED worktree (returns patch) → 2-vote adversarial review of patch → orchestrator returns accepted patches.",
  phases: [
    { title: "Shard", detail: "load results JSON, group failures by signature" },
    { title: "Fix", detail: "one worktree-isolated agent per sig: edit, return git diff as patch" },
    { title: "Review", detail: "2-vote adversarial review of each patch (read-only, main repo)" },
  ],
};

const A = typeof args === "string" ? JSON.parse(args) : args || {};
const REPO = A.repo || "C:\\Users\\dylan\\code\\bun";
const RESULTS = A.results;
const MAX_SIGS = A.max_sigs || 12;
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
    patch: { type: "string" },
  },
  required: ["sig", "files_edited", "summary", "confidence", "patch"],
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

const KNOWN_CLASSES = `**Known Windows bug classes:**
1. **SysV-vs-Win64 ABI**: \`#[unsafe(no_mangle)] extern "C" fn\` taking \`&JSGlobalObject\`/\`&CallFrame\` where C++ declares \`SYSV_ABI\`/\`JSC_CALLCONV\` — wrap in \`bun_jsc::jsc_host_abi! { unsafe fn ... }\`.
2. **Fd kind dispatch**: \`sys_uv::*\` on system-kind (HANDLE) Fd → \`.uv()\` panics. Spec usually kind-dispatches or uses Win32.
3. **Box<uv::Handle> auto-drop**: Zig \`*uv.X\` no drop; Rust \`Box<uv::X>\` drops while async \`uv_close\` pending → UAF.
4. **NTSTATUS→errno**: use \`translate_ntstatus_to_errno\` table, NOT \`RtlNtStatusToDosError\` chain.
5. **cfg arm desync**: signature changed in one cfg arm but not the other.
6. **TODO(b2-windows) stub**: returns null/0/\`&[]\` where Zig has real impl.
7. **Path separator**: hardcoded \`/\` in path joins; use \`bun_paths::SEP\`.`;

phase("Shard");
const shard = await agent(
  `Load + group Windows test failures by signature. Main repo ${REPO}.

1. Read \`${RESULTS}\` (JSON array of {testPath, ok, status, error, exitCode, stdoutPreview, ...}).
2. Filter to \`ok === false\`.
3. Group by **failure signature** — derive a stable key from the FIRST distinctive line:
   - panic at file.rs:line:col → use that
   - "Segmentation fault at address 0x..." → top non-handler stack-frame address from stdoutPreview, else "segfault"
   - "unchecked exception at" → the function@file:line
   - test assertion → first \`expect(...).toBe\` failure line (truncate to 100 chars)
   - else → first 80 chars of error
4. For each group: pick example_test, capture stdoutPreview, list likely_files (file:line from sig if .rs path; else map test area → src/ crate).
5. Sort by count descending. Cap at ${MAX_SIGS}.

**HARD RULES:** Read-only. NO git/cargo/bun. Work in ${REPO}.

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
      `Fix Windows test failure (signature seen in ${s.count} tests). You are in an ISOLATED git worktree — edits here do NOT touch the main repo.

**FIRST:** the worktree may have been created from \`main\` instead of the port branch. Run \`git fetch origin claude/phase-a-port && git checkout origin/claude/phase-a-port -- .\` to sync your worktree's files to the port branch HEAD before reading/editing anything. (This is the ONLY git command you may run besides \`git diff\` at the end.)

**Signature:** \`${s.sig}\`
**Example test:** \`test/${s.example_test}\`
**Stdout/stderr (last 3k):**
\`\`\`
${(s.stdoutPreview || "").slice(-3000)}
\`\`\`
**Likely source files:** ${(s.likely_files || []).join(", ") || "(unknown — investigate)"}

${KNOWN_CLASSES}

**Process:**
1. Read example test → understand the API exercised.
2. Find the failing Rust code (file.rs:line if in sig; else trace from API). Read .zig sibling for spec.
3. Identify bug class or root-cause from first principles.
4. Edit the .rs file(s) to match .zig spec. NO \`#[cfg(any())]\`/\`todo!()\`. NEW \`unsafe\` only with \`// SAFETY:\`.
5. After editing, capture the patch: \`git diff -- src/\` (your worktree's diff vs HEAD). If >3 files or architectural, return confidence:"skip" with patch:"".

**HARD RULES:** NO \`bun bd\`/\`bun test\`/\`cargo\`/\`ninja\`. NO \`git commit/push/stash/reset/checkout\`. ONLY \`git diff\` to capture patch. Edit only \`src/**/*.rs\`.

Return {sig:"${s.sig.replace(/"/g, '\\"').slice(0, 200)}", files_edited:["src/..."], summary:"what+why", confidence, patch:"<full git diff output>"}.`,
      { label: `fix:${s.sig.slice(0, 40)}`, phase: "Fix", schema: FIX_S, isolation: "worktree" },
    ),
  (fix, s) =>
    fix && fix.confidence !== "skip" && fix.patch && fix.patch.length > 10
      ? parallel(
          [0, 1].map(
            i => () =>
              agent(
                `Adversarially review this Windows test-fix patch. Main repo ${REPO}. Read-only. DEFAULT accept:true if no bugs.

**Sig:** \`${s.sig}\`
**Fix summary:** ${fix.summary}
**Files:** ${fix.files_edited.join(", ")}

**PATCH (apply mentally; do NOT git apply):**
\`\`\`diff
${fix.patch.slice(0, 8000)}
\`\`\`

For each hunk: read the full file at that path in ${REPO} + .zig spec at same path. Check:
1. **Spec-match**: does the .zig do this? If YES → accept (correct by construction). If NO → the patch must explain WHY Rust needs it (consolidation/reshape that forced it) and you must agree it's the right layer. "Zig doesn't need this because <comptime/stdlib/different-call-path>" without that explanation = REJECT.
2. **ABI**: extern "C"↔"sysv64" — does C++ decl (grep symbol in src/jsc/bindings/) actually use SYSV_ABI? Wrong-direction is worse than no fix.
3. **UB**: aliased &mut re-entrancy? mem::zeroed on niche? SB violation?
4. **Semantics**: diverges from .zig spec? Windows behavior wrong?
5. **Regression**: breaks non-Windows arm? cfg-gating correct?

**HARD RULES:** Read-only. NO git/cargo/bun.

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
const skipped = fixed.filter(f => f && (f.confidence === "skip" || !f.patch || f.patch.length <= 10));
const rejected = fixed.filter(f => f && !f.accepted && f.confidence !== "skip" && f.patch?.length > 10);

return {
  results_file: RESULTS,
  total_failed: shard.total_failed,
  sigs: shard.sigs.length,
  accepted: accepted.map(f => ({
    sig: f.sig,
    count: f.count,
    files: f.files_edited,
    summary: f.summary,
    patch: f.patch,
  })),
  rejected: rejected.map(f => ({ sig: f.sig, files: f.files_edited, blocking: f.blocking, summary: f.summary })),
  skipped: skipped.map(f => ({ sig: f.sig, summary: f.summary })),
};
