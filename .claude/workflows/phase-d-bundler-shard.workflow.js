export const meta = {
  name: "phase-d-bundler-shard",
  description:
    "Sharded per-file bundler fix. Survey once → fan out per-file (capped 16). bundle_v2 split by line-range.",
  phases: [
    { title: "Survey", detail: "cargo check -p bun_bin → per-file errfiles + bundle_v2 line-buckets" },
    { title: "Fix", detail: "one agent per file/bucket (no cargo)" },
  ],
};

const MAX_ROUNDS = (args && args.max_rounds) || 100;
const SHARD = (args && args.shard) || 0; // 0..N-1
const NSHARDS = (args && args.nshards) || 1;

const SURVEY_S = {
  type: "object",
  properties: {
    units: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string" },
          lo: { type: "number" },
          hi: { type: "number" },
          n: { type: "number" },
          errfile: { type: "string" },
        },
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
    blocked_on: { type: "array", items: { type: "string" } },
    notes: { type: "string" },
  },
  required: ["file"],
};

const HARD = `**HARD RULES:** Edit ONLY your file (and at most 1 upstream type-def if signature change unavoidable — note it). Never git reset/checkout/restore/stash/rebase/pull. Never .zig. **DO NOT run cargo.** Commit only: \`git -c core.hooksPath=/dev/null add -A 'src/' && git -c core.hooksPath=/dev/null commit -q -m "phase-d(bundler): <what>"\`. NO push.`;

let history = [];
for (let round = 1; round <= MAX_ROUNDS; round++) {
  phase("Survey");
  const survey = await agent(
    `Survey bundler errors → per-file errfiles + bundle_v2 line-buckets. Repo /root/bun-5. Shard ${SHARD}/${NSHARDS}.

1. \`rm -rf /tmp/bds${SHARD}-r${round} && mkdir -p /tmp/bds${SHARD}-r${round} && cargo check -p bun_bin --keep-going > /tmp/bds${SHARD}-r${round}/full.log 2>&1\`
2. total = \`grep -cE '^error(\\[|:)' /tmp/bds${SHARD}-r${round}/full.log\`
3. Per-file: \`grep -oP '\\-\\-> \\Ksrc/bundler/[^:]+\\.rs' /tmp/bds${SHARD}-r${round}/full.log | sort | uniq -c\`
4. **For bundle_v2.rs split by line-range** into ~6 buckets of ~800 lines (e.g. 1-900, 900-1800, ..., 4500-5500). For each bucket extract only error blocks where \`--> src/bundler/bundle_v2.rs:LINE:\` and LINE in [lo,hi).
5. **For other files** extract whole-file error blocks: \`awk -v p='--> <file>:' 'BEGIN{RS="\\n\\n"} index($0,p){print $0"\\n"}' full.log > <slug>.err\`
6. Write each errfile to /tmp/bds${SHARD}-r${round}/<slug>.err.

Return {units:[{file, lo?, hi?, n, errfile}], total}. units = ALL files+buckets (sharding done by caller). DO NOT edit src/.`,
    { label: `survey-s${SHARD}-r${round}`, phase: "Survey", schema: SURVEY_S },
  );
  if (!survey) {
    history.push({ round, error: "survey failed" });
    continue;
  }
  if (survey.total === 0) return { rounds: round, done: true, history, shard: SHARD };

  // Shard: stable sort by file+lo, take every NSHARDS-th
  const sorted = survey.units
    .filter(u => u.n > 0)
    .sort((a, b) => (a.file + ":" + (a.lo || 0)).localeCompare(b.file + ":" + (b.lo || 0)));
  const mine = sorted.filter((_, i) => i % NSHARDS === SHARD);
  log(`shard ${SHARD} round ${round}: ${survey.total} total, ${mine.length}/${sorted.length} units`);
  if (mine.length === 0) {
    history.push({ round, total: survey.total, mine: 0 });
    continue;
  }

  await parallel(
    mine.map(
      u => () =>
        agent(
          `Fix ${u.n} compile errors in **${u.file}**${u.lo != null ? ` lines [${u.lo},${u.hi})` : ""}. Repo /root/bun-5 @ HEAD.

**Errfile:** \`cat ${u.errfile}\` (DO NOT run cargo)

**Process:**
1. Read errfile. Read ${u.file}${u.lo != null ? ` (focus lines ${u.lo}-${u.hi})` : ""}. Read .zig spec at same path (src/bundler/*.zig).
2. **Mechanical:** \`unsafe fn\` callers → \`unsafe { }\`, \`r#ref\`→\`ref_\`, BabyList \`.push\`→\`.append\`/\`.len()\`→\`.len\`, module-vs-type imports, missing \`.as_ptr()\`/\`.as_mut_ptr()\`, \`&Vec<T>\`→\`&[T]\`/\`&mut [T]\`.
3. **Missing method/field on shared type** → ADD it (in the type's file, e.g. LinkerContext.rs/Graph.rs/Chunk.rs).
4. **Type mismatch** → adapt YOUR side per .zig spec.
5. **bun_css references in no-default-features path** → gate with \`#[cfg(feature = "css")]\` OR use the crate's css re-export shim if exists.
6. Genuinely blocked → \`todo!("blocked_on: <symbol>")\` (rare).
7. Commit (multiple OK).

${HARD}

Return {file:"${u.file}", before:${u.n}, fns_touched:[...], blocks_on:[...], notes}.`,
          {
            label: `fix:${u.file.replace("src/bundler/", "")}${u.lo != null ? `:${u.lo}` : ""}`,
            phase: "Fix",
            schema: FIX_S,
          },
        ),
    ),
  );

  history.push({ round, total: survey.total, mine: mine.length });
}
return { rounds: MAX_ROUNDS, done: false, history, shard: SHARD };
