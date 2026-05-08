export const meta = {
  name: "phase-d-crate-shard",
  description:
    "Generic sharded per-file fix for any crate. Survey → per-file errfiles (mega-files split by line-range) → fix-agents (no cargo) → re-survey",
  phases: [
    { title: "Survey", detail: "cargo check -p <crate> → per-file errfiles, big files split by line-range" },
    { title: "Fix", detail: "one agent per file/bucket (no cargo)" },
  ],
};

const CRATE = (args && args.crate) || "bun_runtime";
const SRCDIR = (args && args.srcdir) || "src/runtime";
const CHECK_CMD = (args && args.check_cmd) || `cargo check -p ${CRATE} --keep-going`;
const MAX_ROUNDS = (args && args.max_rounds) || 100;
const SHARD = (args && args.shard) || 0;
const NSHARDS = (args && args.nshards) || 1;
const BUCKET_LINES = (args && args.bucket_lines) || 800;
const SPLIT_THRESHOLD = (args && args.split_threshold) || 80;

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
    dep_broken: { type: "array", items: { type: "string" } },
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

const HARD = `**HARD RULES:** Edit ONLY files under **${SRCDIR}/**. **NEVER edit any other crate** (src/jsc, src/install, src/ptr, etc.) — if a missing method/type exists upstream, adapt YOUR call site (cast/wrap/shim locally) or \`todo!("blocked_on: <crate>::<symbol>")\`. Upstream edits break the dep cascade and waste 10M+ tokens. Never git reset/checkout/restore/stash/rebase/pull. Never .zig. **DO NOT run cargo.** Commit only: \`git -c core.hooksPath=/dev/null add -A '${SRCDIR}/' && git -c core.hooksPath=/dev/null commit -q -m "phase-d(${CRATE}): <what>"\`. NO push.`;

let history = [];
for (let round = 1; round <= MAX_ROUNDS; round++) {
  phase("Survey");
  const D = `/tmp/cs-${CRATE}-s${SHARD}-r${round}`;
  const survey = await agent(
    `Survey ${CRATE}: ONE cargo check → per-file errfiles. Repo /root/bun-5. Shard ${SHARD}/${NSHARDS}.

1. \`rm -rf ${D} && mkdir -p ${D} && ${CHECK_CMD} > ${D}/full.log 2>&1\`
2. **FIRST check dep-gate (DO NOT read full.log into context):** \`grep 'could not compile' ${D}/full.log\` — if output names a crate OTHER than \`${CRATE}\`, run \`sleep 90\` and return {units:[], total:0, dep_broken:[<names>]} immediately. Do not cat/head/read the log.
3. total = \`grep -cE '^error(\\[|:)' ${D}/full.log\` (only if ${CRATE} is the failure or check passed)
4. Per-file: \`grep -oP '\\-\\-> \\K${SRCDIR}/[^:]+\\.rs' ${D}/full.log | sort | uniq -c | sort -rn\`
5. **Files with n>${SPLIT_THRESHOLD}** → split into line-buckets of ~${BUCKET_LINES} lines: extract error blocks where \`--> <file>:LINE:\` and LINE in [lo,hi). Write to \`${D}/<slug>_<lo>.err\`.
6. **Other files** → whole-file error blocks: \`awk -v p='--> <file>:' 'BEGIN{RS="\\n\\n"} index($0,p){print $0"\\n"}' ${D}/full.log > ${D}/<slug>.err\`

Return {units:[{file, lo?, hi?, n, errfile}], total, dep_broken:[]}. units = ALL files+buckets. DO NOT edit src/.`,
    { label: `survey-${CRATE}-s${SHARD}-r${round}`, phase: "Survey", schema: SURVEY_S },
  );
  if (!survey) {
    history.push({ round, error: "survey failed" });
    continue;
  }
  if (survey.dep_broken && survey.dep_broken.length > 0) {
    log(`${CRATE} blocked on deps: ${survey.dep_broken.join(",")} — backoff`);
    history.push({ round, dep_broken: survey.dep_broken });
    // Hard backoff: 3 consecutive dep_broken → bail (orchestrator relaunches when ready).
    const recent = history.slice(-3);
    if (recent.length >= 3 && recent.every(h => h.dep_broken)) {
      return { rounds: round, done: false, bailed: "dep_broken_3x", history, shard: SHARD, crate: CRATE };
    }
    await agent(`Run \`sleep 120\` then return "ok".`, { label: `backoff-${CRATE}-s${SHARD}` });
    continue;
  }
  if (survey.total === 0) return { rounds: round, done: true, history, shard: SHARD, crate: CRATE };

  const sorted = survey.units
    .filter(u => u.n > 0)
    .sort((a, b) =>
      (a.file + ":" + String(a.lo || 0).padStart(8, "0")).localeCompare(
        b.file + ":" + String(b.lo || 0).padStart(8, "0"),
      ),
    );
  const mine = sorted.filter((_, i) => i % NSHARDS === SHARD);
  log(`${CRATE} s${SHARD} r${round}: ${survey.total} total, ${mine.length}/${sorted.length} units`);
  if (mine.length === 0) {
    history.push({ round, total: survey.total, mine: 0 });
    continue;
  }

  await parallel(
    mine.map(
      u => () =>
        agent(
          `Fix ${u.n} compile errors in **${u.file}**${u.lo != null ? ` lines [${u.lo},${u.hi})` : ""}. Repo /root/bun-5 @ HEAD.

**Errfile:** \`cat ${u.errfile}\` (${u.n} blocks — DO NOT run cargo)

**Process:**
1. Read errfile. Read ${u.file}${u.lo != null ? ` (focus lines ${u.lo}-${u.hi})` : ""}. Read .zig spec at same path.
2. **Mechanical:** wrap newly-\`unsafe fn\` calls in \`unsafe { }\`, \`r#ref\`→\`ref_\`, BabyList \`.push\`→\`.append\`/\`.len()\`→\`.len\`, module-vs-type imports (\`crate::X\` is a module — use \`crate::x::X\`), Option<&T>↔Option<*mut T>, \`&Vec<T>\`→\`&[T]\`/\`&mut [T]\`.
3. **Missing method/field on type defined in ${SRCDIR}/** → ADD it there. **Missing on UPSTREAM type (other crate)** → write a local extension trait / free fn shim in YOUR file, OR \`todo!("blocked_on: <crate>::<method>")\`. **Missing import** → add \`use\`.
4. **Type mismatch** → adapt YOUR side per .zig spec. **#[cfg(any())]/todo!()** → remove, port REAL body.
5. Genuinely blocked → \`todo!("blocked_on: <symbol>")\` (rare; prefer adding the symbol).
6. Commit (multiple OK).

${HARD}

Return {file:"${u.file}", before:${u.n}, fns_touched:[...], blocked_on:[...], notes}.`,
          {
            label: `fix:${u.file.replace(SRCDIR + "/", "")}${u.lo != null ? `:${u.lo}` : ""}`,
            phase: "Fix",
            schema: FIX_S,
          },
        ),
    ),
  );

  history.push({ round, total: survey.total, mine: mine.length });
}
return { rounds: MAX_ROUNDS, done: false, history, shard: SHARD, crate: CRATE };
