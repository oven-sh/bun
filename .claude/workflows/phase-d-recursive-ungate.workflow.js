export const meta = {
  name: "phase-d-recursive-ungate",
  description:
    "Per-file: remove ALL #[cfg(any())] gates + todo!() stubs, fix-forward against .zig spec, verify. Tier-ordered.",
  phases: [
    { title: "Survey", detail: "count gates per file" },
    { title: "Ungate", detail: "one agent per file: remove gates, fix-forward" },
    { title: "Verify", detail: "2-vote spec check" },
    { title: "Bugfix", detail: "apply verified bugs" },
  ],
};

// Tier order — lower tiers first so upper tiers see real deps.
// Within a tier, all files run in parallel.
const TIERS = (args && args.tiers) || [
  {
    tier: 0,
    crates: ["bun_core", "bun_alloc", "string", "paths", "sys", "ptr", "collections", "safety", "io", "threading"],
  },
  { tier: 1, crates: ["logger", "options_types", "watcher", "crash_handler", "uws_sys", "uws", "aio", "event_loop"] },
  { tier: 2, crates: ["js_parser", "resolver", "shell_parser", "http", "sourcemap", "router"] },
  { tier: 3, crates: ["js_printer", "bundler"] },
  { tier: 4, crates: ["jsc"] },
  {
    tier: 5,
    crates: [
      "runtime",
      "http_jsc",
      "sql_jsc",
      "install_jsc",
      "js_parser_jsc",
      "bundler_jsc",
      "css_jsc",
      "sourcemap_jsc",
    ],
  },
  { tier: 6, crates: ["bun_bin"] },
];
// css/install excluded by default (off -e path); add via args.extra_crates
const EXTRA = (args && args.extra_crates) || [];
if (EXTRA.length) TIERS.push({ tier: 99, crates: EXTRA });

const SURVEY_S = {
  type: "object",
  properties: {
    files: {
      type: "array",
      items: {
        type: "object",
        properties: { file: { type: "string" }, gates: { type: "number" }, todos: { type: "number" } },
        required: ["file", "gates", "todos"],
      },
    },
    total_gates: { type: "number" },
    total_todos: { type: "number" },
  },
  required: ["files", "total_gates", "total_todos"],
};
const UNGATE_S = {
  type: "object",
  properties: {
    file: { type: "string" },
    gates_before: { type: "number" },
    gates_after: { type: "number" },
    todos_before: { type: "number" },
    todos_after: { type: "number" },
    compiles: { type: "boolean" },
    fns_touched: { type: "array", items: { type: "string" } },
    blocked_on: { type: "array", items: { type: "string" } },
    notes: { type: "string" },
  },
  required: ["file", "gates_after", "compiles"],
};
const VERIFY_S = {
  type: "object",
  properties: {
    file: { type: "string" },
    bugs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          fn: { type: "string" },
          what: { type: "string" },
          fix: { type: "string" },
          severity: { type: "string" },
        },
        required: ["fn", "what", "fix"],
      },
    },
  },
  required: ["file", "bugs"],
};
const BUGFIX_S = {
  type: "object",
  properties: { file: { type: "string" }, applied: { type: "number" }, notes: { type: "string" } },
  required: ["file", "applied"],
};

const HARD = `**HARD RULES:** Edit ONLY your assigned file (and at most one upstream type-def file if signature change is unavoidable). Never git reset/checkout/restore/stash. Never edit .zig. Other agents edit OTHER files concurrently — your file is yours alone. **Commit+push with retry:** \`for i in 1 2 3; do git -c core.hooksPath=/dev/null add -A 'src/' && git -c core.hooksPath=/dev/null commit -q -m "phase-d: <file>: <what>" && git -c core.hooksPath=/dev/null pull --no-rebase --no-edit -X ours origin claude/phase-a-port 2>/dev/null && git -c core.hooksPath=/dev/null push origin claude/phase-a-port && break || sleep $((RANDOM%5+1)); done\`. If a sibling file breaks your compile, that's expected — filter cargo errors to YOUR file only.`;

let history = [];

for (const tier of TIERS) {
  phase("Survey");
  log(`tier ${tier.tier}: surveying ${tier.crates.join(",")}`);
  const dirPattern = tier.crates.map(c => `src/${c}/`).join(" ");
  const survey = await agent(
    `Survey gates+todos in tier-${tier.tier} crates. Repo /root/bun-5.

For each .rs file under ${tier.crates.map(c => `src/${c}/`).join(", ")}: count \`#[cfg(any())]\` and \`todo!(\`/\`unimplemented!(\` occurrences. Only files with gates>0 OR todos>0.

Shell: \`for d in ${dirPattern}; do find "$d" -name '*.rs' 2>/dev/null; done | while read f; do g=$(grep -c '#\\[cfg(any())\\]' "$f"); t=$(grep -cE 'todo!\\(|unimplemented!\\(' "$f"); [ $((g+t)) -gt 0 ] && echo "$f $g $t"; done\`

Return {files:[{file,gates,todos}], total_gates, total_todos}. DO NOT edit.`,
    { label: `survey-t${tier.tier}`, phase: "Survey", schema: SURVEY_S },
  );
  if (!survey || survey.files.length === 0) {
    log(`tier ${tier.tier}: 0 gates/todos`);
    history.push({ tier: tier.tier, total_gates: 0, total_todos: 0 });
    continue;
  }
  log(
    `tier ${tier.tier}: ${survey.total_gates} gates + ${survey.total_todos} todos across ${survey.files.length} files`,
  );

  // Per-file pipeline: ungate → 2-vote verify → bugfix
  const results = await pipeline(
    survey.files,
    // Stage 1: ungate
    f =>
      agent(
        `Remove ALL gates+todos from ONE file. Port real bodies from .zig spec. Repo /root/bun-5 @ HEAD.

**File:** ${f.file}
**Gates:** ${f.gates} \`#[cfg(any())]\` + ${f.todos} \`todo!()\`/\`unimplemented!()\`

**Task:** For EVERY \`#[cfg(any())]\` gate and \`todo!()\` in this file:
1. Find the .zig spec at the same path (\`.rs\`→\`.zig\`). Read the function body there.
2. Port the real body. Fix borrow-ck (raw-ptr per-use reborrow per docs/PORTING.md). Adapt to Rust API surface (BabyList .append not .push, ref_ not r#ref, etc.).
3. If genuinely blocked on an upstream type that doesn't exist yet: leave a SINGLE \`todo!("blocked_on: <crate>::<symbol>")\` with the exact blocker. Do NOT re-gate with #[cfg(any())].

**Tier ${tier.tier}** — lower tiers (${
          tier.tier > 0
            ? TIERS.slice(
                0,
                TIERS.findIndex(t => t.tier === tier.tier),
              )
                .flatMap(t => t.crates)
                .join(",")
            : "none"
        }) should be real now.

After: \`cargo check -p <crate> --keep-going\` (filter to your file). Commit. Record fns touched + remaining blocked_on.

${HARD}

**REGRESSION GUARD:** After your edits compile, run \`timeout 2 ./target/debug/bun-rs -e 'console.log(123)'\` — output MUST still be \`123\`. If you broke it, revert your change to the breaking fn (keep the rest) and report in blocked_on. Rebuild first if you touched a compiled crate: \`cargo build -p bun_bin 2>&1 | tail -5\`.

Return {file, gates_before:${f.gates}, gates_after, todos_before:${f.todos}, todos_after, compiles:bool, smoke_ok:bool, fns_touched:[...], blocked_on:[...], notes}.`,
        { label: `ungate:${f.file.split("/").pop()}`, phase: "Ungate", schema: UNGATE_S },
      ),
    // Stage 2: 2-vote verify (only if compiled and touched fns)
    (ug, f) =>
      ug && ug.compiles && (ug.fns_touched || []).length > 0
        ? parallel(
            [0, 1].map(
              i => () =>
                agent(
                  `Adversarially verify ${f.file} against .zig spec. Repo /root/bun-5 @ HEAD.

Un-gater touched fns: ${(ug.fns_touched || []).join(", ")}. Read those in ${f.file} AND .zig spec at same path. Find: spec divergences, silent-no-ops, aliased-&mut, transmute-to-enum, mem::forget/Box::leak for &'static, missing match arms, ptr::read of Drop type, wrong-discriminant. Check docs/PORTING.md §Forbidden.

DEFAULT TO refuted — only report with .zig:line + .rs:line + observable divergence. DO NOT edit. DO NOT report compile errors.

Return {file, bugs:[{fn, what, fix, severity}]}.`,
                  { label: `verify${i}:${f.file.split("/").pop()}`, phase: "Verify", schema: VERIFY_S },
                ),
            ),
          ).then(votes => {
            const all = (votes || []).filter(Boolean).flatMap(v => v.bugs || []);
            const seen = {};
            const bugs = [];
            for (const b of all) {
              const k = `${b.fn}::${(b.what || "").slice(0, 80)}`;
              if (!seen[k]) {
                seen[k] = 1;
                bugs.push(b);
              }
            }
            return { file: f.file, ug, bugs };
          })
        : { file: f.file, ug, bugs: [] },
    // Stage 3: bugfix
    (vr, f) =>
      vr && vr.bugs && vr.bugs.length > 0
        ? agent(
            `Apply verified bugs to ${f.file}. Repo /root/bun-5 @ HEAD.

Verified bugs:
${vr.bugs.map((b, i) => `${i + 1}. **${b.fn}** (${b.severity || "logic-bug"}): ${b.what}\n   FIX: ${b.fix}`).join("\n")}

Apply each. Read .zig spec to confirm. Edit ONLY ${f.file}. After: cargo check still compiles. Commit.

${HARD}

Return {file, applied:N, notes}.`,
            { label: `bugfix:${f.file.split("/").pop()}`, phase: "Bugfix", schema: BUGFIX_S },
          ).then(bf => ({ ...vr, bugfix: bf }))
        : vr,
  );

  const remaining_gates = results.reduce((s, r) => s + ((r && r.ug && r.ug.gates_after) || 0), 0);
  const remaining_todos = results.reduce((s, r) => s + ((r && r.ug && r.ug.todos_after) || 0), 0);
  const total_bugs = results.reduce((s, r) => s + ((r && r.bugs && r.bugs.length) || 0), 0);
  history.push({
    tier: tier.tier,
    files: survey.files.length,
    gates_before: survey.total_gates,
    gates_after: remaining_gates,
    todos_before: survey.total_todos,
    todos_after: remaining_todos,
    bugs_found: total_bugs,
    blocked: results.flatMap(r => (r && r.ug && r.ug.blocked_on) || []),
  });
  log(
    `tier ${tier.tier}: ${survey.total_gates}→${remaining_gates} gates, ${survey.total_todos}→${remaining_todos} todos, ${total_bugs} bugs found`,
  );
}

return { tiers: history };
