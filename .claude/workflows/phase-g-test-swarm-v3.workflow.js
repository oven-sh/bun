export const meta = {
  name: "phase-g-test-swarm-v3",
  description:
    "ONE rebuild/round. Survey writes per-file diagnostics → fix-agents read+fix (NO build) → 2-vote review (NO build) → apply corrections → loop.",
  phases: [
    { title: "Build", detail: "bun bd ONCE, in worktree" },
    { title: "Survey", detail: "run all tests in parallel, write per-file .diag (vs USE_SYSTEM_BUN baseline)" },
    { title: "Fix", detail: "per-file: read .diag + source + .zig spec, fix, commit. NO bun bd, NO cargo." },
    { title: "Review", detail: "2-vote vs .zig spec. NO bun bd. List corrections." },
    { title: "Apply", detail: "apply reviewer corrections. NO bun bd." },
  ],
};

const A = typeof args === "string" ? JSON.parse(args) : args || {};
const SHARD = A.shard ?? 0;
const NSHARDS = A.nshards || 4;
const MAX_ROUNDS = A.max_rounds || 12;
const FAIL_BATCH = A.fail_batch || 14; // stop survey after this many failures
const TEST_GLOB = A.test_glob || "test/js/bun/**/*.test.{js,ts}";
const WT = `/root/bun-5-tswarm-s${SHARD}`;
const DIAG = `/tmp/tswarm-s${SHARD}-diag`;

const BUILD_S = {
  type: "object",
  properties: { ok: { type: "boolean" }, errors: { type: "string" } },
  required: ["ok"],
};
const SURVEY_S = {
  type: "object",
  properties: {
    passing: { type: "array", items: { type: "string" } },
    failing: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string" },
          diag_file: { type: "string" },
          kind: { type: "string" },
          summary: { type: "string" },
        },
        required: ["file", "diag_file", "kind"],
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
    src_files_edited: { type: "array", items: { type: "string" } },
    commit: { type: "string" },
    confidence: { type: "string" },
    notes: { type: "string" },
  },
  required: ["file", "root_cause", "src_files_edited", "commit"],
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
          src_file: { type: "string" },
          what: { type: "string" },
          why: { type: "string" },
          fix: { type: "string" },
          severity: { type: "string" },
        },
        required: ["src_file", "what", "fix", "severity"],
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

const NO_BUILD = `**DO NOT run \`bun bd\`, \`cargo build\`, \`cargo check\`, or any test command.** You work from the diagnostic file + reading source. The orchestrator rebuilds once per round; your job is to make the source edit that will be correct when it does.`;
const HARD = `**HARD RULES:** Work ONLY in ${WT} on branch claude/phase-g-tswarm-s${SHARD}. ${NO_BUILD}

**FIX LAYERING, DON'T WORK AROUND IT.** Low-tier needs high-tier type → MOVE the type down or use \`extern "Rust"\`. NEVER runtime hooks, \`*mut c_void\` round-trips, duplicate types.

**NO NEW \`unsafe {}\` outside FFI.** Reaching for \`unsafe { &mut *ptr }\` → change signature to \`&mut T\`, push deref to caller.

Never git reset/checkout/stash/rebase/pull. **Commit explicit paths:** \`git -c core.hooksPath=/dev/null add 'src/' && git commit -q -m "..."\`. NO push.`;

let history = [];

// ── Isolate (once) — PRESERVE existing commits (rebase, never reset) ──
const iso = await agent(
  `Set up isolated shard ${SHARD}. **Preserve existing commits** — never reset.

\`\`\`sh
if test -d ${WT}; then
  git -C ${WT} fetch origin claude/phase-a-port
  # rebase shard's commits onto latest origin (preserve local work)
  git -C ${WT} rebase origin/claude/phase-a-port || git -C ${WT} rebase --abort
else
  git -C /root/bun-5 worktree add -b claude/phase-g-tswarm-s${SHARD} ${WT} origin/claude/phase-a-port
fi
# push branch so orchestrator can merge anytime (commits durable)
git -C ${WT} push -u origin claude/phase-g-tswarm-s${SHARD} 2>/dev/null || true
\`\`\`
Full isolation — own build/. Return {ok:bool}.`,
  {
    label: `isolate-s${SHARD}`,
    phase: "Build",
    schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
  },
);
if (!iso?.ok) return { error: "isolate failed" };

for (let round = 1; round <= MAX_ROUNDS; round++) {
  // ── Build (ONCE per round) ──
  phase("Build");
  const build = await agent(
    `Build ONCE in ${WT}. \`cd ${WT} && bun bd --version 2>&1 | tail -10\`. If errors, capture them. Return {ok:bool, errors:"..."}.`,
    { label: `build-s${SHARD}-r${round}`, phase: "Build", schema: BUILD_S },
  );
  if (!build?.ok) {
    // build broke — one focused fix-agent (this is the only place rebuild loops are allowed)
    await agent(
      `Build broke in ${WT}. Errors:\n${build?.errors || "(see bun bd output)"}\n\nFix the compile error (read error → edit source → commit). \`cargo check -p <crate>\` allowed here. ${HARD.replace(NO_BUILD, "")}\nReturn {ok}.`,
      { label: `buildfix-s${SHARD}-r${round}`, phase: "Build" },
    );
    history.push({ round, build_broke: true });
    continue;
  }

  // ── Survey (ONCE per round, parallel test runs, write diagnostics) ──
  phase("Survey");
  const survey = await agent(
    `Survey: run tests in **${WT}**, write per-file diagnostics. Shard ${SHARD}/${NSHARDS} round ${round}. **FAIL-FAST: stop after ${FAIL_BATCH} failures.**

**Setup:** \`mkdir -p ${DIAG}\`. **Contiguous slice** (not modulo): \`cd ${WT} && ls ${TEST_GLOB} | sort > ${DIAG}/all.txt\`; total=\$(wc -l < ${DIAG}/all.txt); slice=\$((total/${NSHARDS}+1)); your files = \`sed -n "\$((${SHARD}*slice+1)),\$(((${SHARD}+1)*slice))p" ${DIAG}/all.txt\` — distinct from other shards.

**Baseline (cache once):** for each file, if \`${DIAG}/<slug>.baseline\` doesn't exist: \`USE_SYSTEM_BUN=1 timeout 15 bun test <file> 2>&1 > ${DIAG}/<slug>.baseline\`.

**Probe (sequential, stop at ${FAIL_BATCH} failures):**
\`\`\`sh
fails=0
for f in \$(cat your-slice); do
  timeout 15 ${WT}/build/debug/bun-debug test "\$f" > ${DIAG}/\$(echo \$f|tr / _).log 2>&1
  rc=\$?
  # passing = rc 0 AND pass-count matches baseline
  if [ passing ]; then echo "\$f" >> passing.txt; else echo "\$f|\$rc" >> failing.txt; fails=\$((fails+1)); fi
  [ \$fails -ge ${FAIL_BATCH} ] && break
done
\`\`\`

**For each failing file, write \`${DIAG}/<slug>.diag\`** containing:
- Exit code + kind (crash/hang/diverge)
- Failing test names + assertion messages (grep \`✗\` / \`expect(...)\` lines from .log)
- Diff vs .baseline (which tests pass in Zig but fail in Rust)
- For exit≥128: tail of backtrace
- For hang (124): note "hangs — needs gdb attach in fix phase"

**passing** = exit 0 AND .log pass-count == .baseline pass-count.

Return {passing:[files], failing:[{file, diag_file, kind:"crash|hang|diverge", summary}], total:N}. DO NOT edit src/.`,
    { label: `survey-s${SHARD}-r${round}`, phase: "Survey", schema: SURVEY_S },
  );
  if (!survey) {
    history.push({ round, error: "survey failed" });
    continue;
  }

  log(`r${round}: ${survey.passing.length}/${survey.total} passing, ${survey.failing.length} to fix`);
  if (survey.failing.length === 0)
    return {
      rounds: round,
      done: true,
      passing: survey.passing.length,
      total: survey.total,
      history,
      branch: `claude/phase-g-tswarm-s${SHARD}`,
    };

  // ── Fix → Review → Apply (all NO rebuild, pipelined per file) ──
  await pipeline(
    survey.failing.slice(0, 16),
    // Fix
    f =>
      agent(
        `Fix test divergence for **${f.file}** (kind: ${f.kind}). Worktree ${WT}.

**Diagnostic:** \`cat ${f.diag_file}\` and \`cat ${f.diag_file.replace(".diag", ".log")}\` — this is your ONLY runtime evidence.
**Summary:** ${f.summary}

**Process:**
1. Read the diagnostic. Identify which test(s) fail and what the assertion says (expected vs actual).
2. Read the test file to understand what behavior is expected.
3. Find the implementing Rust source (grep for the API being tested). Read it + the .zig spec at the same path.
4. Diagnose root cause from the SOURCE (you cannot re-run). Common: wrong return value, missing case, off-by-one, uninit field, layout mismatch.
5. Edit the source. Commit.
6. confidence: "high" if the fix obviously matches the assertion; "low" if you're guessing without runtime confirmation.

${HARD}

Return {file:"${f.file}", root_cause, src_files_edited:[...], commit:"<sha>", confidence:"high|low", notes}.`,
        { label: `fix:${f.file.split("/").slice(-2).join("/")}`, phase: "Fix", schema: FIX_S },
      ),
    // Review (2-vote)
    (fix, f) =>
      fix && fix.src_files_edited?.length > 0
        ? parallel(
            [0, 1].map(
              i => () =>
                agent(
                  `Adversarially review fix for ${f.file}. Worktree ${WT}.

**Diff:** \`git -C ${WT} show ${fix.commit}\`
**Root cause claimed:** ${fix.root_cause}
**Diagnostic:** \`cat ${f.diag_file}\`

**Check (NO rebuild — read only):**
1. **NEW non-FFI unsafe?** \`git -C ${WT} show ${fix.commit} | grep '^+.*unsafe {'\` — count non-FFI ones.
2. **Layering workaround?** new hook / c_void round-trip / dup type → REJECT.
3. **Matches .zig spec?** Read .zig at same path as each src_files_edited. Semantic divergence?
4. **Would the fix actually address the assertion in the .diag?** Reason from source.

accept:true ONLY if: 0 non-FFI unsafe + no layering workaround + matches spec + addresses the diagnostic.

${NO_BUILD}

Return {accept, corrections:[{src_file,what,why,fix,severity}], new_unsafe:N}.`,
                  { label: `rev${i}:${f.file.split("/").pop()}`, phase: "Review", schema: REVIEW_S },
                ),
            ),
          ).then(votes => {
            const corr = (votes || []).filter(Boolean).flatMap(v => v.corrections || []);
            const dedup = [];
            const seen = {};
            for (const c of corr) {
              const k = `${c.src_file}::${(c.what || "").slice(0, 50)}`;
              if (!seen[k]) {
                seen[k] = 1;
                dedup.push(c);
              }
            }
            const accepted =
              (votes || []).filter(Boolean).length >= 2 &&
              votes.every(v => v?.accept) &&
              votes.every(v => (v?.new_unsafe || 0) === 0);
            return { file: f.file, fix, accepted, corrections: dedup };
          })
        : null,
    // Apply corrections
    (vr, f) =>
      vr && !vr.accepted && vr.corrections.length > 0
        ? agent(
            `Apply reviewer corrections for ${f.file} in ${WT}.

**${vr.corrections.length} corrections:**
${vr.corrections.map((c, i) => `${i + 1}. [${c.severity}] **${c.src_file}**: ${c.what}\n   WHY: ${c.why}\n   FIX: ${c.fix}`).join("\n")}

Apply each. Read .zig spec to confirm. Commit.

${HARD}

Return {applied:N, commit}.`,
            { label: `apply:${f.file.split("/").pop()}`, phase: "Apply", schema: APPLY_S },
          )
        : vr,
  );

  // Push branch after each round so commits are durable + orchestrator can merge mid-flight
  await agent(
    `Push shard ${SHARD} branch (round ${round} done). \`git -C ${WT} push origin claude/phase-g-tswarm-s${SHARD} 2>&1 | tail -1\`. Return {ok:true}.`,
    { label: `push-s${SHARD}-r${round}`, phase: "Apply" },
  );

  history.push({
    round,
    passing: survey.passing.length,
    total: survey.total,
    fixed_attempted: Math.min(survey.failing.length, 16),
  });
}

return { rounds: MAX_ROUNDS, done: false, history, branch: `claude/phase-g-tswarm-s${SHARD}` };
