export const meta = {
  name: "phase-e-body-port",
  description:
    "Replace ALL todo!()/unimplemented!() with REAL .zig-ported bodies. Port upstream syms transitively. 2-vote verify per file.",
  phases: [
    { title: "Survey", detail: "find files with todo!/unimplemented!/phase_a_draft" },
    { title: "Port", detail: "one agent per file: real bodies from .zig, port upstream deps" },
    { title: "Verify", detail: "2 adversarial reviewers check vs .zig spec" },
  ],
};

const MAX_ROUNDS = (args && args.max_rounds) || 30;
const SHARD = (args && args.shard) || 0;
const NSHARDS = (args && args.nshards) || 1;

const SURVEY_S = {
  type: "object",
  properties: {
    files: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string" },
          todos: { type: "number" },
          unimpls: { type: "number" },
          has_draft: { type: "boolean" },
        },
        required: ["file"],
      },
    },
    total: { type: "number" },
  },
  required: ["files", "total"],
};
const PORT_S = {
  type: "object",
  properties: {
    file: { type: "string" },
    ported: { type: "number" },
    upstream_syms_added: { type: "array", items: { type: "string" } },
    draft_dissolved: { type: "boolean" },
    notes: { type: "string" },
  },
  required: ["file", "ported"],
};
const VERIFY_S = {
  type: "object",
  properties: {
    file: { type: "string" },
    bugs: {
      type: "array",
      items: {
        type: "object",
        properties: { fn: { type: "string" }, what: { type: "string" }, fix: { type: "string" } },
        required: ["fn", "what"],
      },
    },
  },
  required: ["file", "bugs"],
};

const HARD = `**IDIOMATIC RUST ONLY:** Port REAL bodies from .zig spec. NO \`todo!()\`/\`unimplemented!()\`/\`unreachable!()\` (except genuinely-unreachable code). NO \`#[cfg(any())]\`. NO \`phase_a_draft\` mods. Match Zig semantics exactly: error handling, allocation, control flow. Use docs/PORTING.md conventions. If upstream symbol missing → port it too (its file, from its .zig spec). Dep cycle → move type to lower crate. Never reset/checkout/stash/rebase/pull. Commit only: \`git -c core.hooksPath=/dev/null add -A 'src/' && git -c core.hooksPath=/dev/null commit -q -m "phase-e(port): <file> real bodies"\`. NO push.`;

let history = [];
for (let round = 1; round <= MAX_ROUNDS; round++) {
  phase("Survey");
  const survey = await agent(
    `Survey: find files with todo!()/unimplemented!()/phase_a_draft. Repo /root/bun-5.

\`grep -rln 'todo!(\\|unimplemented!(\\|mod phase_a_draft\\|mod _phase_a_draft\\|mod _jsc_gated' src/ --include='*.rs'\`

For each file: count todos, count unimpls, check has_draft mod. total = sum.

Return {files:[{file,todos,unimpls,has_draft}], total}. DO NOT edit.`,
    { label: `survey-r${round}`, phase: "Survey", schema: SURVEY_S },
  );
  if (!survey || survey.total === 0) return { rounds: round, done: true, history };

  const sorted = survey.files
    .filter(f => (f.todos || 0) + (f.unimpls || 0) > 0 || f.has_draft)
    .sort((a, b) => a.file.localeCompare(b.file));
  const mine = sorted.filter((_, i) => i % NSHARDS === SHARD).slice(0, 16);
  log(`r${round}: ${survey.total} deferred, ${mine.length}/${sorted.length} files`);
  if (mine.length === 0) {
    history.push({ round, total: survey.total, mine: 0 });
    return { rounds: round, done: false, history };
  }

  phase("Port");
  const ported = await pipeline(
    mine,
    f =>
      agent(
        `Port REAL bodies for ALL todo!()/unimplemented!() in **${f.file}** (${(f.todos || 0) + (f.unimpls || 0)} deferred${f.has_draft ? ", + dissolve phase_a_draft mod" : ""}). Repo /root/bun-5 @ HEAD.

**Process:**
1. Read ${f.file}. Read .zig spec at same path.
2. For each \`todo!()\`/\`unimplemented!()\`: find the matching fn in .zig, port the FULL body. Match semantics (error paths, allocations, side effects).
3. ${f.has_draft ? "Dissolve `mod phase_a_draft`: its contents are the REAL port. Replace top-level stubs with the draft's impl, delete the mod wrapper." : ""}
4. Missing upstream symbol → port it in its file (from its .zig). Transitively until done.
5. \`cargo check -p <crate>\` → fix until 0 errors in YOUR file.
6. Commit.

${HARD}

Return {file:"${f.file}", ported:N, upstream_syms_added:[...], draft_dissolved:bool, notes}.`,
        { label: `port:${f.file.replace("src/", "")}`, phase: "Port", schema: PORT_S },
      ),
    (port, f) =>
      port && port.ported > 0
        ? parallel(
            [0, 1].map(
              i => () =>
                agent(
                  `Adversarially verify ${f.file} against .zig spec. Repo /root/bun-5 @ HEAD.

Porter claims ${port.ported} bodies ported. Read each fn in .rs + .zig spec. Find: spec divergences, wrong error handling, missed match arms, off-by-ones, alloc/free mismatches, incorrect ptr arith, missing side effects.

DEFAULT to refuted (no bug). DO NOT edit. DO NOT run cargo.

Return {file:"${f.file}", bugs:[{fn, what, fix}]}.`,
                  { label: `verify${i}:${f.file.replace("src/", "")}`, phase: "Verify", schema: VERIFY_S },
                ),
            ),
          ).then(votes => {
            const all = (votes || []).filter(Boolean).flatMap(v => v.bugs || []);
            const k = {};
            const bugs = all.filter(b => {
              const key = `${b.fn}::${b.what.slice(0, 60)}`;
              if (k[key]) return false;
              k[key] = 1;
              return true;
            });
            return { file: f.file, port, bugs };
          })
        : { file: f.file, port, bugs: [] },
  );

  const bugs_found = ported.reduce((s, r) => s + ((r && r.bugs && r.bugs.length) || 0), 0);
  history.push({ round, total: survey.total, mine: mine.length, bugs_found });
}
return { rounds: MAX_ROUNDS, done: false, history };
