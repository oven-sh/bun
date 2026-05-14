export const meta = {
  name: "phase-h-deep-dive",
  description: "One focused agent per high-fail-count test file. Root-cause until 0 fail. Runs in own worktree.",
  phases: [{ title: "Dive", detail: "per-file root-cause + fix loop, 2-vote review" }],
};

const A = typeof args === "string" ? JSON.parse(args) : args || {};
const FILES = A.files || [];
if (!FILES.length) throw new Error("files[] required");
const MAX_ROUNDS = A.max_rounds || 4;
// Worktree mode (default ON if `worktree` arg is given). Each workflow gets
// its own checkout + build dir → no concurrent-relink races with other
// deep-dives / megas. Commits land on `branch`; orchestrator merges later.
const WT = A.worktree || "/root/bun-5";
const BRANCH = A.branch || "claude/phase-a-port";
const IN_WT = WT !== "/root/bun-5";

const FIX_S = {
  type: "object",
  properties: {
    file: { type: "string" },
    before_fail: { type: "number" },
    after_fail: { type: "number" },
    root_cause: { type: "string" },
    files_touched: { type: "array", items: { type: "string" } },
    commit: { type: "string" },
    notes: { type: "string" },
  },
  required: ["file", "before_fail", "after_fail", "root_cause"],
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
          fix: { type: "string" },
          severity: { type: "string" },
        },
        required: ["file", "what", "why_wrong", "severity"],
      },
    },
  },
  required: ["accept", "bugs"],
};

const WT_SETUP = IN_WT
  ? `**Worktree:** Work in ${WT} (branch ${BRANCH}). It needs \`ln -s /root/bun-5/vendor vendor\` and \`ln -s /root/bun-5/node_modules node_modules\` and \`ln -s /root/bun-5/test/node_modules test/node_modules\` (gitignored, do once). Do NOT symlink build/ (rejected by build.ts) — let \`bun bd\` create the worktree's own build dir.`
  : "";

phase("Dive");
const results = await pipeline(FILES, async (file, _orig, idx) => {
  let history = [];
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const fix = await agent(
      `Deep-dive fix for **${file}** (round ${round}). Work in ${WT}.
${WT_SETUP}
${round > 1 ? `Previous round: ${JSON.stringify(history[history.length - 1], null, 2).slice(0, 3000)}` : ""}

**Process:**
1. Run: \`cd ${WT} && BUN_DEBUG_QUIET_LOGS=1 bun bd test ${file} 2>&1\`. Record N fails.
2. Run with \`USE_SYSTEM_BUN=1 bun test ${file}\` to confirm baseline passes (if baseline ALSO fails, this is a test bug not a port bug — note and stop).
3. For each failing test: read the assertion. Find the .rs file implementing the behavior. Read the .zig spec at the same path. Find the divergence (control flow, error case, edge case, off-by-one).
4. Fix the ROOT CAUSE in src/ (not test/). One root cause often fixes many tests in the file.
5. Re-run. Loop within this round until 0 fail OR no further progress.
6. Commit: \`cd ${WT} && git -c core.hooksPath=/dev/null add 'src/' && git -c core.hooksPath=/dev/null commit -q -m "<file>: <root cause>"\`. NO push.

**HARD RULES:** Never edit test/. Never \`git checkout/reset/stash\`. Explicit-path commits only. NO new unsafe outside FFI. Read .zig spec.

Return {file, before_fail, after_fail, root_cause, files_touched, commit, notes}.`,
      { label: `dive-${idx}-r${round}`, phase: "Dive", schema: FIX_S },
    );
    if (!fix) break;
    history.push(fix);
    if (fix.after_fail === 0) return { file, rounds: round, history, done: true };
    if (fix.after_fail >= fix.before_fail && round > 1)
      return { file, rounds: round, history, done: false, stuck: true };

    // 2-vote review on the diff
    const reviews = await parallel(
      [0, 1].map(
        i => () =>
          agent(
            `Adversarially review the fix for ${file} (round ${round}). Diff: \`git -C ${WT} show ${fix.commit || "HEAD"} -- 'src/'\`. Did it fix the ROOT CAUSE or paper over it? UB introduced? Diverges from .zig spec? NEW non-FFI unsafe? Return {accept, bugs:[{file,what,why_wrong,fix,severity}]}.`,
            { label: `review${i}-${idx}-r${round}`, phase: "Dive", schema: REVIEW_S },
          ),
      ),
    );
    const bugs = reviews.filter(Boolean).flatMap(r => r.bugs || []);
    history[history.length - 1].review_bugs = bugs;
  }
  return { file, rounds: MAX_ROUNDS, history, done: false };
});

return { worktree: WT, branch: BRANCH, results: results.filter(Boolean) };
