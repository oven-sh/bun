export const meta = {
  name: "phase-h-deep-dive",
  description: "One focused agent per high-fail-count test file. Root-cause until 0 fail.",
  phases: [{ title: "Dive", detail: "per-file root-cause + fix loop, 2-vote review" }],
};

const A = typeof args === "string" ? JSON.parse(args) : args || {};
const FILES = A.files || [];
if (!FILES.length) throw new Error("files[] required");
const MAX_ROUNDS = A.max_rounds || 4;

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

phase("Dive");
const results = await pipeline(FILES, async (file, _orig, idx) => {
  let history = [];
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const fix = await agent(
      `Deep-dive fix for **${file}** (round ${round}). Work in /root/bun-5.

${round > 1 ? `Previous round: ${JSON.stringify(history[history.length - 1], null, 2).slice(0, 3000)}` : ""}

**Process:**
1. Run: \`BUN_DEBUG_QUIET_LOGS=1 bun bd test ${file} 2>&1\`. Record N fails.
2. Run with \`USE_SYSTEM_BUN=1 bun test ${file}\` to confirm baseline passes (if baseline ALSO fails, this is a test bug not a port bug — note and stop).
3. For each failing test: read the assertion. Find the .rs file implementing the behavior. Read the .zig spec at the same path. Find the divergence (control flow, error case, edge case, off-by-one).
4. Fix the ROOT CAUSE in src/ (not test/). One root cause often fixes many tests in the file.
5. Re-run. Loop within this round until 0 fail OR no further progress.
6. Commit: \`git -c core.hooksPath=/dev/null add 'src/' && git commit -q -m "<file>: <root cause>"\`. NO push.

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
            `Adversarially review the fix for ${file} (round ${round}). Diff: \`git -C /root/bun-5 show ${fix.commit || "HEAD"} -- 'src/'\`. Did it fix the ROOT CAUSE or paper over it? UB introduced? Diverges from .zig spec? NEW non-FFI unsafe? Return {accept, bugs:[{file,what,why_wrong,fix,severity}]}.`,
            { label: `review${i}-${idx}-r${round}`, phase: "Dive", schema: REVIEW_S },
          ),
      ),
    );
    const bugs = reviews.filter(Boolean).flatMap(r => r.bugs || []);
    history[history.length - 1].review_bugs = bugs;
  }
  return { file, rounds: MAX_ROUNDS, history, done: false };
});

return { results: results.filter(Boolean) };
