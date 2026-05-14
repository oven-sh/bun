export const meta = {
  name: "phase-d-bundler-perfile",
  description: "Per-file fix for bundler/* errors. ONE cargo check → split by file → fix-agents (no cargo) → re-survey",
  phases: [
    { title: "Survey", detail: "cargo check -p bun_bundler → per-file error files" },
    { title: "Fix", detail: "one agent per file" },
  ],
};

const MAX_ROUNDS = (args && args.max_rounds) || 100;
const FIX_S = {
  type: "object",
  properties: {
    file: { type: "string" },
    before: { type: "number" },
    fns_touched: { type: "array", items: { type: "string" } },
    blocked_on: { type: "array", items: { type: "string" } },
    notes: { type: "string" },
  },
  required: ["file"],
};
const SURVEY_S = {
  type: "object",
  properties: {
    files: {
      type: "array",
      items: {
        type: "object",
        properties: { file: { type: "string" }, n: { type: "number" }, errfile: { type: "string" } },
        required: ["file", "n", "errfile"],
      },
    },
    total: { type: "number" },
    log: { type: "string" },
  },
  required: ["files", "total"],
};

const HARD = `**HARD RULES:** Edit ONLY your file (and at most 1 upstream type-def if signature change unavoidable — note it). Never git reset/checkout/restore/stash. Never .zig. **DO NOT run cargo** — read errfile, fix, commit. Commit only: \`git -c core.hooksPath=/dev/null add -A 'src/' && git -c core.hooksPath=/dev/null commit -q -m "phase-d(bundler/<file>): <what>"\`. NO push/pull.`;

let history = [];
for (let round = 1; round <= MAX_ROUNDS; round++) {
  phase("Survey");
  const survey = await agent(
    `Survey bun_bundler: ONE cargo check, split errors per-file. Repo /root/bun-5.

1. \`rm -rf /tmp/bd-r${round} && mkdir -p /tmp/bd-r${round} && cargo check -p bun_bundler --keep-going 2>&1 | tee /tmp/bd-r${round}/full.log\`
2. Per-file counts: \`grep -oP '\\-\\-> \\Ksrc/bundler/[^:]+\\.rs' /tmp/bd-r${round}/full.log | sort | uniq -c | sort -rn\`
3. For each file with n>0, write its error blocks: \`awk -v f='<file>' 'BEGIN{RS="\\n\\n"} index($0,"--> "f":"){print $0"\\n"}' /tmp/bd-r${round}/full.log > /tmp/bd-r${round}/<slug>.err\` (slug = file with /→_)
4. total = \`grep -cE '^error(\\[|:)' /tmp/bd-r${round}/full.log\`

Return {files:[{file,n,errfile}], total, log}. DO NOT edit src/.`,
    { label: `survey-r${round}`, phase: "Survey", schema: SURVEY_S },
  );
  if (!survey || survey.total === 0) {
    history.push({ round, total: survey?.total || 0 });
    if (survey && survey.total === 0) return { rounds: round, done: true, history };
    continue;
  }

  const files = survey.files
    .filter(f => f.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 32);
  log(`round ${round}: ${survey.total} errors, ${files.length} files`);

  await parallel(
    files.map(
      f => () =>
        agent(
          `Fix ${f.n} compile errors in **${f.file}**. Repo /root/bun-5 @ HEAD.

**Errfile:** \`cat ${f.errfile}\` (${f.n} errors — DO NOT run cargo)

**Process:**
1. Read errfile. Read ${f.file}. Read .zig spec at same path.
2. **Mechanical:** \`unsafe fn\` callers → \`unsafe { }\`, \`r#ref\`→\`ref_\`, BabyList \`.push\`→\`.append\`, module-vs-type imports.
3. **Type mismatch with sibling:** adapt YOUR side. Missing method/field on shared type → ADD it (in the type's file).
4. **#[cfg(any())] / todo!():** remove, port REAL body from .zig.
5. **Genuinely blocked:** \`todo!("blocked_on: <symbol>")\`.
6. Commit.

${HARD}

Return {file:"${f.file}", before:${f.n}, fns_touched:[...], blocked_on:[...], notes}.`,
          { label: `fix:${f.file.replace("src/bundler/", "")}`, phase: "Fix", schema: FIX_S },
        ),
    ),
  );

  history.push({ round, total: survey.total, files: files.length });
}
return { rounds: MAX_ROUNDS, done: false, history };
