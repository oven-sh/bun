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
  },
  required: ["passing", "failing", "total"],
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

Never git reset/checkout/stash/rebase/pull. **Commit explicit paths ONLY:** \`git -c core.hooksPath=/dev/null add <exact files you edited> && git commit -q -m "..."\` (not \`add 'src/'\` — only YOUR files). NO push.`;

let history = [];

for (let round = 1; round <= MAX_ROUNDS; round++) {
  // ── Build (ONCE) ──
  phase("Build");
  const build = await agent(
    `Build ONCE in /root/bun-5. \`git -C /root/bun-5 symbolic-ref HEAD || git checkout claude/phase-a-port; bun bd --version 2>&1 | tail -10\`. Return {ok, errors}.`,
    { label: `build-r${round}`, phase: "Build", schema: BUILD_S },
  );
  if (!build?.ok) {
    await agent(
      `Build broke in /root/bun-5. Errors: ${build?.errors}. Fix compile error → commit. \`cargo check\` allowed here.`,
      { label: `buildfix-r${round}`, phase: "Build" },
    );
    history.push({ round, build_broke: true });
    continue;
  }

  // ── Survey (ONCE, parallel xargs) ──
  phase("Survey");
  const survey = await agent(
    `Survey ALL tests in /root/bun-5. Round ${round}.

\`mkdir -p ${DIAG}\`. List: \`ls ${TEST_GLOB} | sort > ${DIAG}/all.txt\` (~340 files).

**Baseline (cache, only first time):** \`cat ${DIAG}/all.txt | xargs -P 16 -I{} sh -c 'slug=\$(echo {}|tr / _); test -f ${DIAG}/\$slug.baseline || USE_SYSTEM_BUN=1 timeout 15 bun test {} > ${DIAG}/\$slug.baseline 2>&1'\`

**Probe (parallel 16):** \`cat ${DIAG}/all.txt | xargs -P 16 -I{} sh -c 'slug=\$(echo {}|tr / _); timeout 15 ./build/debug/bun-debug test {} > ${DIAG}/\$slug.log 2>&1; echo "{}|\$?" >> ${DIAG}/results-r${round}.txt'\`

**Triage:** for each file, passing = exit 0 AND \`grep -oP '\\d+ pass' .log\` matches .baseline. For each failing: write \`${DIAG}/<slug>.diag\` with {kind: crash|hang|diverge, exit, failing-test-names + assertions (grep ✗/expect lines), diff vs baseline, backtrace tail if crash}.

Return {passing:N, failing:[{file,diag,kind,summary}], total:N}. DO NOT edit src/.`,
    { label: `survey-r${round}`, phase: "Survey", schema: SURVEY_S },
  );
  if (!survey) {
    history.push({ round, error: "survey failed" });
    continue;
  }
  log(`r${round}: ${survey.passing}/${survey.total} passing, ${survey.failing.length} failing`);
  if (survey.failing.length === 0)
    return { rounds: round, done: true, passing: survey.passing, total: survey.total, history };

  // ── Fix → Review → Apply (pipelined per file, MAX_FIX wide) ──
  const targets = survey.failing.slice(0, MAX_FIX);
  await pipeline(
    targets,
    f =>
      agent(
        `Fix **${f.file}** (kind: ${f.kind}). /root/bun-5.

**Diagnostic:** \`cat ${f.diag}\` and \`cat ${f.diag.replace(".diag", ".log")}\` — your ONLY runtime evidence.
${f.summary}

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
    model: "haiku",
  });
  history.push({ round, passing: survey.passing, total: survey.total, fixed: targets.length });
}
return { rounds: MAX_ROUNDS, done: false, history };
