export const meta = {
  name: "phase-d-build-queue",
  description: "cargo build IS the queue: survey frontier → fix per-file in parallel → re-survey → repeat until link",
  phases: [
    { title: "Survey", detail: "cargo build -p bun_bin → group errors by file" },
    { title: "Fix", detail: "one agent per frontier file, in parallel" },
    { title: "Verify", detail: "2-vote spec check on touched fns" },
    { title: "Bugfix", detail: "apply verified bugs" },
  ],
};

const MAX_ROUNDS = (args && args.max_rounds) || 12;
const MAX_FILES_PER_ROUND = (args && args.max_files) || 25;

const SURVEY_S = {
  type: "object",
  properties: {
    by_file: { type: "object" },
    total: { type: "number" },
    link_ok: { type: "boolean" },
    sample_errors: { type: "string" },
  },
  required: ["by_file", "total", "link_ok"],
};
const FIX_S = {
  type: "object",
  properties: {
    file: { type: "string" },
    before: { type: "number" },
    after: { type: "number" },
    fixed: { type: "boolean" },
    fns_touched: { type: "array", items: { type: "string" } },
    ungated: { type: "number" },
    blocked_on: { type: "array", items: { type: "string" } },
    notes: { type: "string" },
  },
  required: ["file", "fixed", "after"],
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

const HARD = `**HARD RULES:** Edit ONLY your assigned file (and at most one upstream type-def file if signature change is unavoidable — note it in fns_touched). Never git reset/checkout/restore/stash. Never .zig. Other agents own OTHER frontier files this round. **Commit+push with retry:** \`for i in 1 2 3 4 5; do git -c core.hooksPath=/dev/null add -A 'src/' && git -c core.hooksPath=/dev/null commit -q -m "phase-d: <file>: <what>" 2>/dev/null && git -c core.hooksPath=/dev/null pull --no-rebase --no-edit -X ours origin claude/phase-a-port 2>/dev/null; git -c core.hooksPath=/dev/null push origin claude/phase-a-port && break || sleep $((RANDOM%6+1)); done\`. Filter cargo errors to YOUR file only — sibling breakage is expected mid-round.`;

let history = [];
let seen_files = {};

for (let round = 1; round <= MAX_ROUNDS; round++) {
  phase("Survey");
  const survey = await agent(
    `Survey the build frontier. Repo /root/bun-5.

Run: \`cargo build -p bun_bin 2>&1 | tee /tmp/pd-build-r${round}.log | grep -E '^error\\[|^error:' -A2 | grep -oP '\\-\\-> \\K[^:]+\\.rs' | sort | uniq -c | sort -rn\`

Parse into {by_file: {"src/...": N, ...}, total: <count of lines matching '^error\\[|^error:'>, link_ok: <true if "Finished" in output AND total==0>}. Also grab first 30 error lines as sample_errors.

DO NOT edit. Return {by_file, total, link_ok, sample_errors}.`,
    { label: `survey-r${round}`, phase: "Survey", schema: SURVEY_S },
  );

  if (!survey) {
    history.push({ round, error: "survey failed" });
    continue;
  }
  if (survey.link_ok || survey.total === 0) {
    log(`round ${round}: LINKED — cargo build -p bun_bin succeeded`);
    return { rounds: round, linked: true, history };
  }

  // Frontier = files with errors this round. Prioritize new files, then highest error count.
  const frontier = Object.entries(survey.by_file)
    .filter(([f, n]) => n > 0)
    .sort(([fa, na], [fb, nb]) => {
      const sa = seen_files[fa] || 0,
        sb = seen_files[fb] || 0;
      if (sa !== sb) return sa - sb; // unseen first
      return nb - na; // then by error count desc
    })
    .slice(0, MAX_FILES_PER_ROUND);
  for (const [f] of frontier) seen_files[f] = (seen_files[f] || 0) + 1;

  log(
    `round ${round}: ${survey.total} errors, frontier ${frontier.length} files: ${frontier.map(([f, n]) => `${f.split("/").pop()}(${n})`).join(" ")}`,
  );

  // Per-file pipeline: fix → 2-vote verify → bugfix (no barrier between stages)
  const results = await pipeline(
    frontier,
    // Stage 1: fix
    ([file, n]) =>
      agent(
        `Fix ALL ${n} compile errors in ONE frontier file. Port real bodies from .zig spec where needed. Repo /root/bun-5 @ HEAD.

**File:** ${file}  (${n} errors; ${seen_files[file] > 1 ? `seen ${seen_files[file]}× — likely type-seam or sibling-signature drift` : "new this round"})
**See errors:** \`grep -B2 -A10 '${file}:' /tmp/pd-build-r${round}.log\`

**Fix forward — NEVER re-gate:**
- Most errors are mechanical patterns. Sweep them first: wrap newly-\`unsafe fn\` accessor calls in \`unsafe { }\`, \`r#ref\`→\`ref_\`, \`*const [u8]\` field → \`unsafe { &*p }\`, BabyList \`.push\`→\`.append\`, \`.len()\`→\`.len\` field, module-vs-type imports (\`crate::VirtualMachine\` is a module, use \`crate::virtual_machine::VirtualMachine\`).
- If error is in a \`#[cfg(any())]\`-gated fn or \`todo!()\`: remove the gate, port the REAL body from the .zig spec at same path. Adapt API surface per docs/PORTING.md.
- For mega-files (>200 errs): mechanical sweep first (sed-style), then per-fn port for remaining.
- If type mismatch with a sibling crate: prefer adapting YOUR file to the sibling's signature (sibling agent owns their file).
- If genuinely blocked on a missing upstream symbol: leave \`todo!("blocked_on: <crate>::<symbol>")\` and report in blocked_on.

After: \`cargo build -p bun_bin 2>&1 | grep '${file}:' | grep -c 'error\\['\` → should be 0. Commit. Record fns_touched + how many gates you removed.

${HARD}

Return {file, before:${n}, after:N, fixed:bool, fns_touched:[...], ungated:N, blocked_on:[...], notes}.`,
        { label: `fix:${file.split("/").pop()}`, phase: "Fix", schema: FIX_S },
      ),
    // Stage 2: 2-vote verify
    (fix, [file]) =>
      fix && fix.fixed && (fix.fns_touched || []).length > 0
        ? parallel(
            [0, 1].map(
              i => () =>
                agent(
                  `Adversarially verify ${file} against .zig spec. Repo /root/bun-5 @ HEAD.

Fixer touched fns: ${(fix.fns_touched || []).join(", ")}. Read those in ${file} AND .zig spec at same path. Find: spec divergences, silent-no-ops, aliased-&mut, transmute-to-enum, mem::forget/Box::leak for &'static, missing match arms, ptr::read of Drop type, wrong-discriminant. Check docs/PORTING.md §Forbidden.

DEFAULT TO refuted — only report with .zig:line + .rs:line + observable divergence. DO NOT edit. DO NOT report compile errors.

Return {file, bugs:[{fn, what, fix, severity}]}.`,
                  { label: `verify${i}:${file.split("/").pop()}`, phase: "Verify", schema: VERIFY_S },
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
            return { file, fix, bugs };
          })
        : { file, fix, bugs: [] },
    // Stage 3: bugfix
    (vr, [file]) =>
      vr && vr.bugs && vr.bugs.length > 0
        ? agent(
            `Apply verified bugs to ${file}. Repo /root/bun-5 @ HEAD.

Verified bugs (2-vote against .zig spec):
${vr.bugs.map((b, i) => `${i + 1}. **${b.fn}** (${b.severity || "logic-bug"}): ${b.what}\n   FIX: ${b.fix}`).join("\n")}

Apply each. Read .zig spec to confirm. Edit ONLY ${file}. After: cargo build still compiles your file. Commit.

${HARD}

Return {file, applied:N, notes}.`,
            { label: `bugfix:${file.split("/").pop()}`, phase: "Bugfix", schema: BUGFIX_S },
          ).then(bf => ({ ...vr, bugfix: bf }))
        : vr,
  );

  const after_total = results.reduce((s, r) => s + ((r && r.fix && r.fix.after) || 0), 0);
  const total_bugs = results.reduce((s, r) => s + ((r && r.bugs && r.bugs.length) || 0), 0);
  const ungated = results.reduce((s, r) => s + ((r && r.fix && r.fix.ungated) || 0), 0);
  const blocked = results.flatMap(r => (r && r.fix && r.fix.blocked_on) || []);
  history.push({
    round,
    total_before: survey.total,
    frontier_files: frontier.length,
    total_after_in_frontier: after_total,
    ungated,
    bugs_found: total_bugs,
    blocked,
  });
}

return { rounds: MAX_ROUNDS, linked: false, history };
