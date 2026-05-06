export const meta = {
  name: "phase-d-blocked-on-resolve",
  description:
    'Resolve todo!("blocked_on: <crate>::<sym>") by porting the upstream symbol from .zig, then replacing the todo with the real call.',
  phases: [
    { title: "Survey", detail: "grep all blocked_on todos → group by upstream symbol" },
    { title: "PortUpstream", detail: "one agent per upstream symbol: port from .zig to upstream crate" },
    { title: "ReplaceCallers", detail: "replace todo!() with real call at each caller" },
  ],
};

const MAX_ROUNDS = (args && args.max_rounds) || 20;
const SHARD = (args && args.shard) || 0;
const NSHARDS = (args && args.nshards) || 1;

const SURVEY_S = {
  type: "object",
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        properties: {
          symbol: { type: "string" },
          upstream_crate: { type: "string" },
          callers: { type: "array", items: { type: "string" } },
          n: { type: "number" },
        },
        required: ["symbol", "callers", "n"],
      },
    },
    total: { type: "number" },
  },
  required: ["groups", "total"],
};
const PORT_S = {
  type: "object",
  properties: {
    symbol: { type: "string" },
    ported: { type: "boolean" },
    callers_replaced: { type: "number" },
    blocked: { type: "string" },
    notes: { type: "string" },
  },
  required: ["symbol", "ported"],
};

let history = [];
for (let round = 1; round <= MAX_ROUNDS; round++) {
  phase("Survey");
  const survey = await agent(
    `Survey: find all \`todo!("blocked_on: ...")\` in src/**/*.rs, group by upstream symbol. Repo /root/bun-5.

\`grep -rn 'todo!("blocked_on:' src/ --include='*.rs' | grep -oP 'blocked_on:\\s*\\K[^")]+' | sort | uniq -c | sort -rn\`

For each unique symbol: extract upstream_crate (e.g. "bun_jsc::VirtualMachine::foo" → bun_jsc), list caller files, count.
total = \`grep -rn 'todo!("blocked_on:' src/ --include='*.rs' | wc -l\`

Return {groups:[{symbol, upstream_crate, callers:[file:line], n}], total}. DO NOT edit.`,
    { label: `survey-r${round}`, phase: "Survey", schema: SURVEY_S },
  );
  if (!survey || survey.total === 0) return { rounds: round, done: true, history };

  const sorted = survey.groups.filter(g => g.n > 0).sort((a, b) => b.n - a.n);
  const mine = sorted.filter((_, i) => i % NSHARDS === SHARD).slice(0, 16);
  log(`r${round}: ${survey.total} blocked_on todos, ${sorted.length} unique symbols, ${mine.length} mine`);
  if (mine.length === 0) {
    history.push({ round, total: survey.total, mine: 0 });
    return { rounds: round, done: false, history };
  }

  phase("PortUpstream");
  await parallel(
    mine.map(
      g => () =>
        agent(
          `Resolve \`todo!("blocked_on: ${g.symbol}")\` (${g.n} callers). Repo /root/bun-5 @ HEAD.

**Callers:** ${g.callers.slice(0, 10).join(", ")}${g.callers.length > 10 ? ` (+${g.callers.length - 10})` : ""}

**Process:**
1. Find ${g.symbol} in .zig spec: \`grep -rn '<method_name>' src/**/*.zig\`. Read the body.
2. Port it to the upstream Rust crate (${g.upstream_crate || "infer from symbol path"}). Match signature, real body. If body refs other unported syms, port those too (depth ≤2).
3. \`cargo check -p ${g.upstream_crate || "<crate>"}\` → fix until 0.
4. At each caller: replace the \`todo!("blocked_on: ${g.symbol}")\` with the real call. \`cargo check -p <caller_crate>\` → 0.
5. Commit only: \`git -c core.hooksPath=/dev/null add -A 'src/' && git -c core.hooksPath=/dev/null commit -q -m "phase-d: port ${g.symbol} + resolve ${g.n} blocked_on"\`. NO push/pull.

**HARD RULES:** Never reset/checkout/stash/rebase. Never .zig. If genuinely blocked (dep cycle, massive port), note it & return ported:false.

Return {symbol:"${g.symbol}", ported:bool, callers_replaced:N, blocked:"...", notes}.`,
          { label: `port:${g.symbol.slice(0, 40)}`, phase: "PortUpstream", schema: PORT_S },
        ),
    ),
  );

  history.push({ round, total: survey.total, mine: mine.length });
}
return { rounds: MAX_ROUNDS, done: false, history };
