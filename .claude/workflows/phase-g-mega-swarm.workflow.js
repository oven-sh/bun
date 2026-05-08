export const meta = {
  name: "phase-g-mega-swarm",
  description:
    "ONE rebuild/round in main repo. Survey ALL tests (parallel xargs). Fan out 30+ fix-agents (NO rebuild, explicit-path commits). 2-vote review each. Loop.",
  phases: [
    { title: "Build", detail: "bun bd ONCE in /root/bun-5" },
    {
      title: "Survey",
      detail: "run all ~340 tests via xargs -P16, write per-file .diag vs cached USE_SYSTEM_BUN baseline",
    },
    {
      title: "Fix",
      detail:
        "30+ parallel fix-agents, one per failing test, read .diag + source + .zig, commit explicit paths. NO rebuild.",
    },
    { title: "Review", detail: "2-vote per fix (NO rebuild)" },
    { title: "Apply", detail: "reviewer corrections (NO rebuild)" },
  ],
};

const A = typeof args === "string" ? JSON.parse(args) : args || {};
const MAX_ROUNDS = A.max_rounds || 10;
const MAX_FIX = A.max_fix || 30; // parallel fix-agents per round
const TEST_GLOB = A.test_glob || "test/js/bun/**/*.test.{js,ts}";
const FILE_CAP = A.file_cap || 50; // hard cap on files surveyed per round
const DIAG = "/tmp/mega-diag";

const BUILD_S = {
  type: "object",
  properties: { ok: { type: "boolean" }, errors: { type: "string" } },
  required: ["ok"],
};
const SURVEY_S = {
  type: "object",
  properties: {
    passing: { type: "number" },
    failing: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string" },
          diag: { type: "string" },
          kind: { type: "string" },
          summary: { type: "string" },
        },
        required: ["file", "diag", "kind"],
      },
    },
    total: { type: "number" },
    uncovered: { type: "number" },
  },
  required: ["passing", "failing", "total", "uncovered"],
};
const FIX_S = {
  type: "object",
  properties: {
    file: { type: "string" },
    root_cause: { type: "string" },
    src_edited: { type: "array", items: { type: "string" } },
    commit: { type: "string" },
    confidence: { type: "string" },
  },
  required: ["file", "root_cause", "src_edited", "commit"],
};
const REVIEW_S = {
  type: "object",
  properties: {
    accept: { type: "boolean" },
    corrections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          src: { type: "string" },
          what: { type: "string" },
          fix: { type: "string" },
          severity: { type: "string" },
        },
        required: ["src", "what", "fix", "severity"],
      },
    },
    new_unsafe: { type: "number" },
  },
  required: ["accept", "corrections"],
};
const APPLY_S = {
  type: "object",
  properties: { applied: { type: "number" }, commit: { type: "string" } },
  required: ["applied"],
};

const NO_BUILD = `**DO NOT run \`bun bd\`, \`cargo build\`, \`cargo check\`, or any test command.** Work from the diagnostic + source. Orchestrator rebuilds once per round.`;
const HARD = `**HARD RULES:** Work in /root/bun-5 on branch claude/phase-a-port. ${NO_BUILD}

**FIX LAYERING.** Low-tier needs high-tier type → MOVE down or \`extern "Rust"\`. NEVER hooks/c_void round-trips/dup types.
**NO NEW \`unsafe {}\` outside FFI.** Reaching for \`unsafe { &mut *ptr }\` → change signature to \`&mut T\`.
**FFI unsafe goes in ONE place.** If you add an \`extern "Rust"/"C"\` function, wrap it in ONE safe inline fn that does \`unsafe { extern_fn(...) }\`; call sites use the wrapper. Adding \`unsafe {}\` at N>2 call sites for the same extern is wrong.
**NO JUSTIFICATION COMMENTS.** Do NOT add \`// PORT NOTE: reshaped for borrowck\` / \`// TODO(port):\` / long \`// SAFETY:\` essays explaining why a workaround is OK. If you need a paragraph to justify it, the code is wrong — fix the code instead. A good fix needs at most a one-line "why" that a Rust dev would write, not a port history.

Never git reset/checkout/stash/rebase/pull. **Commit explicit paths ONLY:** \`git -c core.hooksPath=/dev/null add <exact files you edited> && git commit -q -m "..."\` (not \`add 'src/'\` — only YOUR files). NO push. **NEVER --allow-empty. Commit message ≤ 80 chars** — describe WHAT changed, not your analysis.`;

let history = [];

// Per-glob diag dir to avoid cross-swarm clobbering
const GLOB_ID = TEST_GLOB.replace(/[^a-z]/gi, "_").slice(0, 40);
const GDIAG = `${DIAG}/${GLOB_ID}`;

for (let round = 1; round <= MAX_ROUNDS; round++) {
  // ── Wait for builder daemon (NO bun bd here) ──
  phase("Build");
  const build = await agent(
    `Wait for builder daemon. **DO NOT run bun bd** — a daemon owns the build. \`mkdir -p ${GDIAG}; for i in $(seq 1 60); do test -f /tmp/mega-diag/.built && break; sleep 5; done; test -f /tmp/mega-diag/.built && tail -3 /tmp/mega-diag/.build.log\`. If build.log shows errors, return {ok:false, errors:"..."}. Else {ok:true}.`,
    { label: `wait-build-r${round}`, phase: "Build", schema: BUILD_S },
  );
  if (!build?.ok) {
    await agent(
      `Build daemon reports failure. Errors: ${build?.errors}. Fix compile error → commit. \`cargo check\` allowed here. The daemon will rebuild on next loop.`,
      { label: `buildfix-r${round}`, phase: "Build" },
    );
    history.push({ round, build_broke: true });
    continue;
  }

  // ── Survey (ONCE, parallel xargs) ──
  phase("Survey");
  const survey = await agent(
    `Survey ALL tests in /root/bun-5. Round ${round}.

\`mkdir -p ${DIAG} ${GDIAG}; touch ${GDIAG}/triaged-slow.txt ${GDIAG}/passing.txt\`. **List ALL files, EXCLUDING triaged-slow + already-passing**: \`find ${TEST_GLOB.replace("/**/*.test.{js,ts}", "")} \\( -name '*.test.ts' -o -name '*.test.js' \\) | sort | grep -vxFf ${GDIAG}/triaged-slow.txt | grep -vxFf ${GDIAG}/passing.txt > ${GDIAG}/all.txt\`. **Round-${round} working set** (${round === 1 ? `first ${FILE_CAP}` : `next ${FILE_CAP} not-yet-covered + still-failing from round ${round - 1}`}): \`{ ${round === 1 ? "" : `cat ${GDIAG}/failing-r${round - 1}.txt 2>/dev/null; `}head -${FILE_CAP * round} ${GDIAG}/all.txt | tail -${FILE_CAP}; } | sort -u > ${GDIAG}/working-r${round}.txt\`.

**Baseline (cache, only first time):** \`cat ${GDIAG}/all.txt | xargs -P 16 -I{} sh -c 'slug=\$(echo {}|tr / _); test -f ${DIAG}/\$slug.baseline || USE_SYSTEM_BUN=1 timeout 15 bun test {} > ${DIAG}/\$slug.baseline 2>&1'\`

**Probe (parallel 16):** \`cat ${GDIAG}/working-r${round}.txt | xargs -P 16 -I{} sh -c 'slug=\$(echo {}|tr / _); timeout 15 ./build/debug/bun-debug test {} > ${DIAG}/\$slug.log 2>&1; echo "{}|\$?" >> ${GDIAG}/results-r${round}.txt'\`. Write \`${GDIAG}/failing-r${round}.txt\` (exit≠0/1) and append exit-0 files to \`${GDIAG}/passing.txt\` (cumulative — never re-surveyed).

**Triage — only DIVERGENCES from baseline are bugs:**
For each file: rust_rc from results, baseline_rc = parse \`${DIAG}/<slug>.baseline\` (look for "X pass" or exit marker; if .baseline is empty/timeout-only, baseline_rc=124).

| rust_rc | baseline_rc | verdict |
|---|---|---|
| ≥128 | any | **crash** → failing |
| 1 | 0 | **diverge** → failing |
| 124 | 0 | check .log: if ≥1 ✓/pass line → debug-slow, append to triaged-slow.txt; if banner-only → **real-hang** → failing |
| 0 | 0 | passing |
| 1 or 124 | 1 or 124 | **baseline-also-fails** → append to triaged-slow.txt (env/slow, not a port bug) |

summary = first 2 ✗ lines from .log (or backtrace tail for crash, or "no output past banner" for real-hang).

**uncovered** = \`wc -l < ${GDIAG}/all.txt\` minus files probed so far (i.e., files in glob never yet surveyed).

Return {passing:N, failing:[{file,diag:"${DIAG}/<slug>.log",kind:"crash|diverge|real-hang",summary}], total:N, uncovered:N}. **Only return failing entries that are TRUE divergences.** DO NOT edit src/.`,
    { label: `survey-r${round}`, phase: "Survey", schema: SURVEY_S },
  );
  if (!survey) {
    history.push({ round, error: "survey failed" });
    continue;
  }
  log(
    `r${round}: ${survey.passing}/${survey.total} passing, ${survey.failing.length} failing, ${survey.uncovered ?? "?"} uncovered`,
  );
  // Only done when no failures AND no uncovered files remain in the glob.
  if (survey.failing.length === 0 && (survey.uncovered ?? 1) === 0)
    return { rounds: round, done: true, passing: survey.passing, total: survey.total, history };
  // No fix targets this round but more files to cover → advance
  if (survey.failing.length === 0) {
    history.push({ round, passing: survey.passing, total: survey.total, advanced: true });
    continue;
  }

  // ── Fix → Review → Apply (pipelined per file, MAX_FIX wide) ──
  const targets = survey.failing.slice(0, MAX_FIX);
  await pipeline(
    targets,
    f =>
      agent(
        `Fix **${f.file}** (kind: ${f.kind}). /root/bun-5.

**Diagnostic:** \`cat ${f.diag}\` (test output) and \`cat ${f.diag.replace(".log", ".baseline")}\` (system-bun baseline) — your ONLY runtime evidence.
${f.summary}

**If the diagnostic shows passing assertions but timeout (kind:hang) AND siblings prove the code path works:** this is debug-slowness, NOT a port bug. Do NOT commit. Return \`{file, root_cause:"debug-slow: <one-line why>", src_edited:[], commit:"NONE", confidence:"high"}\` and append the file to \`${GDIAG}/triaged-slow.txt\` so it's excluded from future rounds. **NEVER \`git commit --allow-empty\`. NEVER write analysis essays in commit messages.**

1. Read diagnostic → which test(s) fail, what assertion says.
2. Read test file → expected behavior.
3. Find implementing Rust source (grep API name). Read it + .zig spec at same path.
4. Diagnose root cause from SOURCE. Edit. Commit ONLY the files you edited.
5. confidence: high|low.

${HARD}

Return {file:"${f.file}", root_cause, src_edited:[...], commit, confidence}.`,
        { label: `fix:${f.file.split("/").slice(-2).join("/")}`, phase: "Fix", schema: FIX_S },
      ),
    (fix, f) =>
      fix?.src_edited?.length > 0
        ? parallel(
            [0, 1].map(
              i => () =>
                agent(
                  `Review fix for ${f.file}. /root/bun-5. Diff: \`git show ${fix.commit}\`. Diagnostic: \`cat ${f.diag}\`.

1. NEW non-FFI unsafe? \`git show ${fix.commit} | grep '^+.*unsafe {'\` count.
2. Layering workaround? hook/c_void/dup-type → REJECT.
2b. **Justification-comment reward-hacking?** \`git show ${fix.commit} | grep -cE '^\\+.*(PORT NOTE|TODO\\(port\\)|reshaped for borrowck|SAFETY:.{100,})'\` — if added, the fix is explaining why a hack is OK instead of fixing properly. REJECT with severity:"reward-hack".
3. Matches .zig spec? Read .zig at each src_edited path.
4. Would fix address the assertion in .diag? Reason from source.

accept:true ONLY if 0 non-FFI unsafe + no workaround + matches spec + addresses diag. ${NO_BUILD}

Return {accept, corrections:[{src,what,fix,severity}], new_unsafe}.`,
                  { label: `r${i}:${f.file.split("/").pop()}`, phase: "Review", schema: REVIEW_S },
                ),
            ),
          ).then(vs => {
            const corr = (vs || []).filter(Boolean).flatMap(v => v.corrections || []);
            const dedup = [];
            const k = {};
            for (const c of corr) {
              const key = `${c.src}::${(c.what || "").slice(0, 50)}`;
              if (!k[key]) {
                k[key] = 1;
                dedup.push(c);
              }
            }
            return {
              file: f.file,
              fix,
              accepted:
                (vs || []).filter(Boolean).length >= 2 && vs.every(v => v?.accept && (v?.new_unsafe || 0) === 0),
              corrections: dedup,
            };
          })
        : null,
    (vr, f) =>
      vr && !vr.accepted && vr.corrections.length > 0
        ? agent(
            `Apply ${vr.corrections.length} corrections for ${f.file}. /root/bun-5.\n${vr.corrections.map((c, i) => `${i + 1}. [${c.severity}] ${c.src}: ${c.what}\n   FIX: ${c.fix}`).join("\n")}\n${HARD}\nReturn {applied,commit}.`,
            { label: `apply:${f.file.split("/").pop()}`, phase: "Apply", schema: APPLY_S },
          )
        : vr,
  );

  // Push after round (durable + orchestrator can see)
  await agent(`Push: \`git -C /root/bun-5 push origin claude/phase-a-port 2>&1 | tail -1\`. Return ok.`, {
    label: `push-r${round}`,
    phase: "Apply",
  });
  history.push({ round, passing: survey.passing, total: survey.total, fixed: targets.length });
}
return { rounds: MAX_ROUNDS, done: false, history };
