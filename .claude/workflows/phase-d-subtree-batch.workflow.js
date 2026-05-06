export const meta = {
  name: "phase-d-subtree-batch",
  description:
    "ONE cargo check per round (survey). Group errors by subtree → feed errors to fix-agents (no cargo). Re-survey.",
  phases: [
    { title: "Survey", detail: "cargo check once → group errors by subtree, write per-subtree error files" },
    { title: "Fix", detail: "one agent per subtree reads its error file, fixes, commits (NO cargo)" },
    { title: "Verify", detail: "2-vote spec check" },
    { title: "Bugfix", detail: "apply verified bugs" },
  ],
};

const MAX_ROUNDS = (args && args.max_rounds) || 10;
const MAX_BATCHES = (args && args.max_batches) || 32;

const SURVEY_S = {
  type: "object",
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        properties: {
          subtree: { type: "string" },
          files: {
            type: "array",
            items: {
              type: "object",
              properties: { file: { type: "string" }, n: { type: "number" } },
              required: ["file", "n"],
            },
          },
          total: { type: "number" },
          errfile: { type: "string" },
        },
        required: ["subtree", "files", "total", "errfile"],
      },
    },
    total: { type: "number" },
    link_ok: { type: "boolean" },
    log: { type: "string" },
  },
  required: ["groups", "total", "link_ok"],
};
const FIX_S = {
  type: "object",
  properties: {
    subtree: { type: "string" },
    before: { type: "number" },
    files_touched: { type: "array", items: { type: "string" } },
    fns_touched: { type: "array", items: { type: "string" } },
    blocked_on: { type: "array", items: { type: "string" } },
    notes: { type: "string" },
  },
  required: ["subtree"],
};
const VERIFY_S = {
  type: "object",
  properties: {
    subtree: { type: "string" },
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
  required: ["subtree", "bugs"],
};
const BUGFIX_S = {
  type: "object",
  properties: { subtree: { type: "string" }, applied: { type: "number" }, notes: { type: "string" } },
  required: ["subtree", "applied"],
};

const HARD = `**HARD RULES:** Never #[cfg(any())]/todo!()/unimplemented!() — port REAL bodies from .zig. Never git reset/checkout/restore/stash. Never edit .zig. DO NOT run cargo. **Commit only (NO push, NO pull):** \`git -c core.hooksPath=/dev/null add -A "src/" && git -c core.hooksPath=/dev/null commit -q -m "phase-d: <what>"\` — orchestrator pushes.`;

let history = [];
let seen = {};

for (let round = 1; round <= MAX_ROUNDS; round++) {
  phase("Survey");
  const survey = await agent(
    `Survey: ONE cargo check, group errors by subtree, write per-subtree error files. Repo /root/bun-5.

1. Run: \`rm -rf /tmp/pd-r${round} && mkdir -p /tmp/pd-r${round} && cargo check --workspace --keep-going --message-format=human 2>&1 | tee /tmp/pd-r${round}/full.log\`
2. Extract per-file counts: \`grep -oP '\\-\\-> \\K[^:]+\\.rs' /tmp/pd-r${round}/full.log | sort | uniq -c\`
3. Group by **dirname(file)** — strip the trailing /<name>.rs. So \`src/runtime/node/node_fs.rs\` → group \`src/runtime/node\`; \`src/runtime/jsc_hooks.rs\` → group \`src/runtime\`. Shell: \`grep -oP '\\-\\-> \\K[^:]+\\.rs' /tmp/pd-r${round}/full.log | sed 's|/[^/]*\\.rs$||' | sort | uniq -c | sort -rn\`
4. **For each subtree, extract its error blocks** to \`/tmp/pd-r${round}/<slug>.err\` (slug = subtree with /→_). Use: \`awk -v st='<subtree>/' 'BEGIN{RS="\\n\\n"} index($0,"--> "st){print $0"\\n"}' /tmp/pd-r${round}/full.log > /tmp/pd-r${round}/<slug>.err\` — each .err contains ONLY error blocks whose primary \`-->\` is in that subtree's files (not cross-ref notes).
5. total = \`grep -cE '^error\\[' /tmp/pd-r${round}/full.log\`. link_ok = total==0 && "Finished" in output.

Return {groups:[{subtree, files:[{file,n}], total, errfile:"/tmp/pd-r${round}/<slug>.err"}], total, link_ok, log:"/tmp/pd-r${round}/full.log"}. DO NOT edit src/.`,
    { label: `survey-r${round}`, phase: "Survey", schema: SURVEY_S },
  );
  if (!survey) {
    history.push({ round, error: "survey failed" });
    continue;
  }
  if (survey.link_ok || survey.total === 0) {
    log(`round ${round}: 0 errors — cargo check -p bun_bin clean`);
    return { rounds: round, linked: true, history };
  }

  const groups = survey.groups
    .filter(g => g.total > 0)
    .sort((a, b) => {
      const sa = seen[a.subtree] || 0,
        sb = seen[b.subtree] || 0;
      if (sa !== sb) return sa - sb;
      return b.total - a.total;
    })
    .slice(0, MAX_BATCHES);
  for (const g of groups) seen[g.subtree] = (seen[g.subtree] || 0) + 1;

  log(`round ${round}: ${survey.total} errors, ${groups.length} subtrees`);

  const results = await pipeline(
    groups,
    // Stage 1: fix subtree (NO cargo)
    g =>
      agent(
        `Fix ALL ${g.total} compile errors in subtree ${g.subtree}/. Repo /root/bun-5 @ HEAD.

**Your error log:** \`${g.errfile}\` (read this — DO NOT run cargo)
**Files & error counts:**
${g.files.map(f => `  ${f.file}: ${f.n}`).join("\n")}
${seen[g.subtree] > 1 ? `**Seen ${seen[g.subtree]}× — likely cross-subtree type seam.**` : ""}

**Process:**
1. \`cat ${g.errfile}\` — read all your errors. If huge: \`head -2000 ${g.errfile}\` then work in batches.
2. **Mechanical sweep first** (most errors): wrap newly-\`unsafe fn\` calls in \`unsafe { }\`, \`r#ref\`→\`ref_\`, \`*const [u8]\` → \`unsafe { &*p }\`, BabyList \`.push\`→\`.append\` / \`.len()\`→\`.len\`, module-vs-type imports (\`crate::VirtualMachine\` is a module — use \`crate::virtual_machine::VirtualMachine\`), Option<&T>→Option<*mut T>.
3. **Shared types in your subtree**: change once, fix all callers in your subtree.
4. **#[cfg(any())] / todo!() in your subtree**: remove, port REAL body from .zig spec. NEVER add new gates or todo!().
5. **Type mismatch with sibling subtree**: adapt YOUR side.
6. **Missing lower-tier symbol**: GO ADD IT to that crate (note in files_touched). **Dep-cycle (lower tier importing higher tier)**: code is in WRONG crate — MOVE it to the right crate, or strip the bogus dependency. No hooks, no gates.
7. Commit (can be multiple). DO NOT run cargo — next survey checks your work.

${HARD}

Return {subtree:"${g.subtree}", before:${g.total}, files_touched:[...], fns_touched:[...], blocked_on:[...], notes}.`,
        { label: `fix:${g.subtree.replace("src/", "")}`, phase: "Fix", schema: FIX_S },
      ),
    // Stage 2: 2-vote verify (NO cargo)
    (fix, g) =>
      fix && (fix.fns_touched || []).length > 0
        ? parallel(
            [0, 1].map(
              i => () =>
                agent(
                  `Adversarially verify ${g.subtree}/ against .zig spec. Repo /root/bun-5 @ HEAD.

Fixer touched: ${(fix.fns_touched || []).slice(0, 40).join(", ")}${(fix.fns_touched || []).length > 40 ? ` (+${fix.fns_touched.length - 40} more)` : ""}. Read those fns in .rs + .zig spec at same path. Find: spec divergences, silent-no-ops, aliased-&mut, transmute-to-enum, mem::forget/Box::leak for &'static, missing match arms, ptr::read of Drop type, wrong-discriminant. Check docs/PORTING.md §Forbidden.

DEFAULT TO refuted. DO NOT run cargo. DO NOT edit.

Return {subtree, bugs:[{fn, what, fix, severity}]}.`,
                  { label: `verify${i}:${g.subtree.replace("src/", "")}`, phase: "Verify", schema: VERIFY_S },
                ),
            ),
          ).then(votes => {
            const all = (votes || []).filter(Boolean).flatMap(v => v.bugs || []);
            const sn = {};
            const bugs = [];
            for (const b of all) {
              const k = `${b.fn}::${(b.what || "").slice(0, 80)}`;
              if (!sn[k]) {
                sn[k] = 1;
                bugs.push(b);
              }
            }
            return { subtree: g.subtree, fix, bugs };
          })
        : { subtree: g.subtree, fix, bugs: [] },
    // Stage 3: bugfix (NO cargo)
    (vr, g) =>
      vr && vr.bugs && vr.bugs.length > 0
        ? agent(
            `Apply verified bugs to ${g.subtree}/. Repo /root/bun-5 @ HEAD.

Verified bugs:
${vr.bugs.map((b, i) => `${i + 1}. **${b.fn}** (${b.severity || "logic-bug"}): ${b.what}\n   FIX: ${b.fix}`).join("\n")}

Apply each. Read .zig spec to confirm. Edit ${g.subtree}/ only. Commit. DO NOT run cargo.

${HARD}

Return {subtree, applied:N, notes}.`,
            { label: `bugfix:${g.subtree.replace("src/", "")}`, phase: "Bugfix", schema: BUGFIX_S },
          ).then(bf => ({ ...vr, bugfix: bf }))
        : vr,
  );

  const bugs = results.reduce((s, r) => s + ((r && r.bugs && r.bugs.length) || 0), 0);
  const blocked = results.flatMap(r => (r && r.fix && r.fix.blocked_on) || []);
  history.push({ round, total: survey.total, subtrees: groups.length, bugs_found: bugs, blocked });
}
return { rounds: MAX_ROUNDS, linked: false, history };
