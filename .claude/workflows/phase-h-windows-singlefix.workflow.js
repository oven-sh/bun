export const meta = {
  name: "phase-h-windows-singlefix",
  description:
    "Single targeted fix: one worktree-isolated fix-agent → 2-vote adversarial review → return patch. For build errors, hangs, CI failures.",
  phases: [
    { title: "Fix", detail: "one worktree-isolated agent: investigate, edit, return git diff" },
    { title: "Review", detail: "2-vote adversarial review of patch" },
  ],
};

const A = typeof args === "string" ? JSON.parse(args) : args || {};
const REPO = A.repo || "C:\\Users\\dylan\\code\\bun";
const PROBLEM = A.problem; // free-text description of the issue
const HINTS = A.hints || ""; // optional: file paths, log excerpts, suspected cause
if (!PROBLEM) throw new Error("args.problem required");

const FIX_S = {
  type: "object",
  properties: {
    files_edited: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low", "skip"] },
    patch: { type: "string" },
    zig_spec_match: { type: "string" },
  },
  required: ["files_edited", "summary", "confidence", "patch", "zig_spec_match"],
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
          severity: { type: "string", enum: ["ub", "leak", "semantics", "abi", "build", "style"] },
        },
        required: ["what", "why_wrong", "severity"],
      },
    },
  },
  required: ["accept", "bugs"],
};

phase("Fix");
const fix = await agent(
  `Fix this issue in the Bun Zig→Rust port. You are in an ISOLATED git worktree.

**FIRST:** worktree may be at \`main\` instead of the port branch. Run \`git fetch origin claude/phase-a-port && git checkout origin/claude/phase-a-port -- .\` before reading/editing.

**Problem:**
${PROBLEM}

${HINTS ? `**Hints/context:**\n${HINTS}\n` : ""}

**Process:**
1. Investigate root cause. Read relevant .rs/.ts/.zig files. The .zig at the same path as a .rs is the spec.
2. Fix the root cause. NO \`#[cfg(any())]\`/\`todo!()\`. NEW \`unsafe\` only with \`// SAFETY:\`.
3. **Spec-match check**: does the .zig spec do what your fix does? If YES, cite file:line. If NO, explain WHY Rust needs it (consolidation/reshape) and why this is the right layer.
4. Capture patch: \`git diff -- src/ scripts/ .buildkite/\`. If >5 files or architectural, return confidence:"skip" with patch:"" and explain.

**HARD RULES:** NO \`bun bd\`/\`cargo build\`/\`ninja\`. \`cargo check -p <crate>\` is OK to verify your edit compiles. NO \`git commit/push/stash/reset\`. ONLY \`git fetch/checkout\` (step 1) and \`git diff\` (step 4).

Return {files_edited:["src/..."], summary:"root-cause + fix", confidence, patch:"<full git diff>", zig_spec_match:"<file:line> OR 'not-spec: <why>'"}.`,
  { label: "fix", phase: "Fix", schema: FIX_S, isolation: "worktree" },
);

if (!fix || fix.confidence === "skip" || !fix.patch || fix.patch.length <= 10) {
  return { problem: PROBLEM, accepted: false, fix, reason: "skipped or empty patch" };
}

phase("Review");
const votes = await parallel(
  [0, 1].map(
    i => () =>
      agent(
        `Adversarially review this fix for the Bun Zig→Rust port. Main repo ${REPO}. Read-only. DEFAULT accept:true if no bugs.

**Problem:** ${PROBLEM}
**Fix summary:** ${fix.summary}
**Files:** ${fix.files_edited.join(", ")}
**Spec-match claim:** ${fix.zig_spec_match}

**PATCH (apply mentally; do NOT git apply):**
\`\`\`diff
${fix.patch.slice(0, 10000)}
\`\`\`

For each hunk: read full file at that path in ${REPO} + .zig spec at same path. Check:
1. **Spec-match**: verify the zig_spec_match claim. If "not-spec", do you agree it's the right layer?
2. **Correctness**: does this actually fix the stated problem? Trace the failure path.
3. **Regression**: breaks other arch/OS/profile? (e.g. cfg-gating, debug vs release)
4. **UB/Semantics**: aliased &mut? mem::zeroed niche? diverges from spec?

**HARD RULES:** Read-only. NO git/cargo/bun.

Return {accept, bugs:[{file,what,why_wrong,severity}]}.`,
        { label: `rev${i}`, phase: "Review", schema: REVIEW_S },
      ),
  ),
);

const v = (votes || []).filter(Boolean);
const blocking = v.flatMap(r =>
  (r.bugs || []).filter(b => ["ub", "leak", "semantics", "abi", "build"].includes(b.severity)),
);
const accepted = v.length >= 2 && v.every(r => r.accept) && blocking.length === 0;

return {
  problem: PROBLEM,
  accepted,
  fix: { files: fix.files_edited, summary: fix.summary, zig_spec_match: fix.zig_spec_match, patch: fix.patch },
  blocking,
  votes: v.map(r => ({ accept: r.accept, bug_count: (r.bugs || []).length })),
};
