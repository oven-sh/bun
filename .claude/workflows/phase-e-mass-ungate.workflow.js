export const meta = {
  name: "phase-e-mass-ungate",
  description: "Remove ALL #[cfg(any())] gates → fix resulting errors per-crate (no re-gating)",
  phases: [
    { title: "Ungate", detail: "strip all #[cfg(any())] / #![cfg(any())] / mod _gated wrappers" },
    { title: "Survey", detail: "cargo check --workspace → per-crate per-file errfiles" },
    { title: "Fix", detail: "one agent per file (NO re-gating, port from .zig)" },
  ],
};

const MAX_ROUNDS = (args && args.max_rounds) || 80;
const SHARD = (args && args.shard) || 0;
const NSHARDS = (args && args.nshards) || 1;

const SURVEY_S = {
  type: "object",
  properties: {
    units: {
      type: "array",
      items: {
        type: "object",
        properties: { file: { type: "string" }, n: { type: "number" }, errfile: { type: "string" } },
        required: ["file", "n", "errfile"],
      },
    },
    total: { type: "number" },
  },
  required: ["units", "total"],
};
const FIX_S = {
  type: "object",
  properties: {
    file: { type: "string" },
    before: { type: "number" },
    fns_touched: { type: "array", items: { type: "string" } },
    notes: { type: "string" },
  },
  required: ["file"],
};

const HARD = `**HARD RULES — GATING IS BANNED:** NEVER add \`#[cfg(any())]\` / \`#![cfg(any())]\` / \`mod _gated\`. Fix the code. If a symbol is missing upstream, PORT IT (add the method/type/fn to the upstream crate from its .zig spec). If that creates a dep cycle, MOVE the type to a lower crate. \`todo!()\` only as absolute last resort with explicit blocked_on note. Never git reset/checkout/stash/rebase/pull. Never .zig. **DO NOT run cargo.** Commit only: \`git -c core.hooksPath=/dev/null add -A 'src/' && git -c core.hooksPath=/dev/null commit -q -m "phase-e: <what>"\`. NO push.`;

let history = [];
for (let round = 1; round <= MAX_ROUNDS; round++) {
  if (round === 1 && SHARD === 0) {
    phase("Ungate");
    await agent(
      `Mass-ungate: strip all \`#[cfg(any())]\` / \`#![cfg(any())]\` from src/**/*.rs. Repo /root/bun-5.

1. \`grep -rln '#\\[cfg(any())\\]\\|#!\\[cfg(any())\\]' src/ --include='*.rs'\` → for each file, sed-delete the attr line.
2. For \`mod _gated { #![cfg(any())] ... }\` wrappers in lib.rs files: unwrap the mod (move inner items to top level, delete wrapper). Handle name collisions by deduping (keep the more-complete version per .zig spec).
3. \`grep -rn '#\\[cfg(any())\\]\\|#!\\[cfg(any())\\]' src/ --include='*.rs' | wc -l\` → must be 0.

Commit only: \`git -c core.hooksPath=/dev/null add -A 'src/' && git -c core.hooksPath=/dev/null commit -q -m "phase-e: mass-ungate (gating banned)"\`. NO push. DO NOT fix errors.`,
      { label: "mass-ungate", phase: "Ungate" },
    );
  }

  phase("Survey");
  const D = `/tmp/ug-s${SHARD}-r${round}`;
  const survey = await agent(
    `Survey: cargo check --workspace --keep-going → per-file errfiles. Repo /root/bun-5. Shard ${SHARD}/${NSHARDS}.

1. \`rm -rf ${D} && mkdir -p ${D} && cargo check --workspace --keep-going > ${D}/full.log 2>&1\`
2. total = \`grep -cE '^error(\\[|:)' ${D}/full.log\`
3. Per-file: \`grep -oP '\\-\\-> \\Ksrc/[^:]+\\.rs' ${D}/full.log | sort | uniq -c | sort -rn\`
4. Write per-file error blocks: \`awk -v p='--> <file>:' 'BEGIN{RS="\\n\\n"} index($0,p){print $0"\\n"}' ${D}/full.log > ${D}/<slug>.err\`

Return {units:[{file,n,errfile}], total}. DO NOT edit src/.`,
    { label: `survey-s${SHARD}-r${round}`, phase: "Survey", schema: SURVEY_S },
  );
  if (!survey || survey.total === 0) return { rounds: round, done: survey?.total === 0, history };

  const sorted = survey.units.filter(u => u.n > 0).sort((a, b) => a.file.localeCompare(b.file));
  const mine = sorted.filter((_, i) => i % NSHARDS === SHARD);
  log(`r${round}: ${survey.total} errs, ${mine.length}/${sorted.length} files`);
  if (mine.length === 0) {
    history.push({ round, total: survey.total, mine: 0 });
    continue;
  }

  phase("Fix");
  await parallel(
    mine.map(
      u => () =>
        agent(
          `Fix ${u.n} compile errors in **${u.file}**. Repo /root/bun-5 @ HEAD.

**Errfile:** \`cat ${u.errfile}\` (DO NOT run cargo)

**Process:**
1. Read errfile + ${u.file} + .zig spec at same path.
2. Fix each error by PORTING the real impl. Missing upstream method/type → add it to upstream crate's file from .zig spec. Dep cycle → move type down.
3. **NEVER** re-add \`#[cfg(any())]\` or \`mod _gated\`. **NEVER** \`unreachable!()\` for non-dead code.
4. Commit.

${HARD}

Return {file:"${u.file}", before:${u.n}, fns_touched:[...], notes}.`,
          { label: `fix:${u.file.replace("src/", "")}`, phase: "Fix", schema: FIX_S },
        ),
    ),
  );

  history.push({ round, total: survey.total, mine: mine.length });
}
return { rounds: MAX_ROUNDS, done: false, history };
