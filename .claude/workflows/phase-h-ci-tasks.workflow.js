export const meta = {
  name: "phase-h-ci-tasks",
  description:
    "Process /tmp/tasks/*.md CI failures. Per-task: read-only fix-agent (NO build/git) → 2-vote adversarial review → bugfix-agent. Orchestrator commits explicit-path.",
  phases: [
    { title: "Fix", detail: "one agent per task: read log+src, edit src/ ONLY, no build/git" },
    { title: "Review", detail: "2 adversarial reviewers per fix" },
    { title: "Apply", detail: "bugfix-agent applies review findings" },
  ],
};

const A = typeof args === "string" ? JSON.parse(args) : args || {};
// Caller passes explicit task list: [{id, path}] — no Load agent.
const TASKS = A.tasks || [];
if (!TASKS.length) throw new Error("args.tasks: [{id, path}] required");
const REPO = A.repo || "/root/bun-5";
// `allowExec`: lift the read-only constraint for tasks that need runtime
// repro (flakes that round-3 had to skip). Fix-agents may then `bun bd` +
// run tests under a cgroup. They MUST run sequentially in that mode (shared
// build dir), so the pipeline is forced to width 1 — see SEQUENTIAL gate.
const ALLOW_EXEC = !!A.allowExec;
// `reviewRounds`: review→apply loops "until dry" — repeat until both
// reviewers accept or this many rounds exhausted (default 1 = legacy).
const REVIEW_ROUNDS = A.reviewRounds || 1;

const FIX_S = {
  type: "object",
  properties: {
    task: { type: "string" },
    root_cause: { type: "string" },
    files_edited: { type: "array", items: { type: "string" } },
    diff_summary: { type: "string" },
    skipped: { type: "boolean" },
    skip_reason: { type: "string" },
    notes: { type: "string" },
  },
  required: ["task", "root_cause", "files_edited"],
};
const REVIEW_S = {
  type: "object",
  properties: {
    accept: { type: "boolean" },
    bugs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string" },
          what: { type: "string" },
          why_wrong: { type: "string" },
          fix: { type: "string" },
          severity: { type: "string" },
        },
        required: ["file", "what", "why_wrong", "severity"],
      },
    },
  },
  required: ["accept", "bugs"],
};
const APPLY_S = {
  type: "object",
  properties: {
    task: { type: "string" },
    applied: { type: "number" },
    files_edited: { type: "array", items: { type: "string" } },
  },
  required: ["task", "applied"],
};

const HARD_RO = `**HARD RULES (per-agent):** READ-ONLY analysis + Edit src/ files. **DO NOT** run \`cargo\`, \`bun bd\`, \`bun test\`, \`bun build\`, or ANY build/exec/spawn command (parallel agents would race). **DO NOT** use git (commit/reset/checkout/stash/pull/push/diff). Edit files via the Edit tool ONLY; the orchestrator commits. NO new unsafe outside FFI. Read .zig spec for the matching file. If the task is a duplicate / known debug-artifact / needs test/ edit (forbidden) — set skipped:true + skip_reason and edit nothing.`;
const HARD_EXEC = `**RULES (exec mode):** You MAY \`bun bd --version\` and run tests under \`systemd-run --scope --user -p MemoryMax=4G -- timeout 60 build/debug/bun-debug test ...\`. You run SEQUENTIALLY (sole owner of the build dir during your turn). **DO NOT** use git (commit/reset/checkout/stash/pull/push). Edit src/ or test/ via the Edit tool ONLY; the orchestrator commits. ALLOWED to diverge from .zig spec. NO new unsafe outside FFI. If you cannot reproduce after 5 cgroup'd runs, set skipped:true + skip_reason="not reproducible locally" and edit nothing.`;
const HARD = ALLOW_EXEC ? HARD_EXEC : HARD_RO;

phase("Fix");
log(`processing ${TASKS.length} tasks (exec=${ALLOW_EXEC}, reviewRounds=${REVIEW_ROUNDS})`);
// SEQUENTIAL gate: when fix-agents may build, they share ${REPO}/build/ and
// would clobber each other. Process one task end-to-end before starting the
// next. Reviewers within a task still run in parallel (read-only).
const runner = ALLOW_EXEC
  ? async (items, ...stages) => {
      const out = [];
      for (const it of items) {
        let v = it;
        for (const [i, s] of stages.entries()) v = await s(v, it, i);
        out.push(v);
      }
      return out;
    }
  : pipeline;
const results = await runner(
  TASKS,
  t =>
    agent(
      `Fix CI failure **${t.id}**. Read the task file: \`cat ${t.path}\` (it has the CI log/stack trace).

Repo at ${REPO} — READ the implicated src/ file(s) + the .zig spec at the same path.

**Process:**
1. Read ${t.path}. Identify the failing assertion / panic / build error and the implicated src/ file.
2. Read that src/ file + its .zig spec. Find the divergence that explains the symptom.
3. **Edit src/ (or scripts/build/ for build failures) ONLY** via the Edit tool to fix the ROOT CAUSE.
4. List exactly which files you edited (absolute paths).

${HARD}

Return {task:"${t.id}", root_cause, files_edited:[...], diff_summary:"one-line", skipped:bool, skip_reason, notes}.`,
      { label: `fix:${t.id}`, phase: "Fix", schema: FIX_S },
    ),
  (fix, t) =>
    fix && !fix.skipped && (fix.files_edited || []).length > 0
      ? parallel(
          [0, 1].map(
            i => () =>
              agent(
                `Adversarially review the fix for **${t.id}**. Task: \`cat ${t.path}\`. Fix-agent claims: root_cause="${(fix.root_cause || "").slice(0, 400)}", edited=${JSON.stringify(fix.files_edited)}, summary="${fix.diff_summary || ""}".

Read the edited files (current state, post-edit) + .zig spec at same path.

**Check:** Root cause or paper-over? Diverges from .zig spec? UB? NEW non-FFI unsafe? Breaks callers? Would actually fix the CI symptom?

DEFAULT accept:true if no bugs. **DO NOT** edit/run.

Return {accept, bugs:[{file,what,why_wrong,fix,severity}]}.`,
                { label: `rev${i}:${t.id}`, phase: "Review", schema: REVIEW_S },
              ),
          ),
        ).then(votes => {
          const all = (votes || []).filter(Boolean).flatMap(v => v.bugs || []);
          const seen = {};
          const bugs = all.filter(b => {
            const k = `${b.file}::${(b.what || "").slice(0, 60)}`;
            if (seen[k]) return false;
            seen[k] = 1;
            return true;
          });
          const accepted = (votes || []).filter(Boolean).every(v => v && v.accept);
          return { task: t.id, fix, accepted, bugs };
        })
      : { task: t.id, fix, accepted: !!(fix && fix.skipped), bugs: [], skipped: !!(fix && fix.skipped) },
  async (vr, t) => {
    // review→apply loops "until dry": re-review after each apply round.
    let cur = vr;
    for (let round = 1; round <= REVIEW_ROUNDS; round++) {
      if (!cur || cur.skipped || cur.accepted || !(cur.bugs && cur.bugs.length > 0)) break;
      const a = await agent(
        `Apply reviewer corrections for **${t.id}** (round ${round}/${REVIEW_ROUNDS}). Original fix touched: ${JSON.stringify((cur.fix || {}).files_edited)}.

**${cur.bugs.length} reviewer findings:**
${cur.bugs.map((b, i) => `${i + 1}. [${b.severity}] **${b.file}**: ${b.what}\n   WHY: ${b.why_wrong}\n   FIX: ${b.fix}`).join("\n")}

Edit the files to apply each correction. ${HARD}

Return {task:"${t.id}", applied:N, files_edited:[...]}.`,
        { label: `apply${round}:${t.id}`, phase: "Apply", schema: APPLY_S },
      );
      cur = { ...cur, apply: a };
      if (round >= REVIEW_ROUNDS) break;
      // Re-review the post-apply state.
      const votes = await parallel(
        [0, 1].map(
          i => () =>
            agent(
              `Adversarially RE-review **${t.id}** after apply round ${round}. Task: \`cat ${t.path}\`. Edited: ${JSON.stringify([...(cur.fix?.files_edited || []), ...((a && a.files_edited) || [])])}. Read current state of those files + .zig spec.

**Check:** Root cause or paper-over? UB? NEW non-FFI unsafe? Breaks callers? Would actually fix the CI symptom?

Return {accept, bugs:[...]}.`,
              { label: `rev${i}r${round + 1}:${t.id}`, phase: "Review", schema: REVIEW_S },
            ),
        ),
      );
      const all = (votes || []).filter(Boolean).flatMap(v => v.bugs || []);
      const seen = {};
      const bugs = all.filter(b => {
        const k = `${b.file}::${(b.what || "").slice(0, 60)}`;
        if (seen[k]) return false;
        seen[k] = 1;
        return true;
      });
      cur = { ...cur, accepted: (votes || []).filter(Boolean).every(v => v && v.accept), bugs };
    }
    return cur;
  },
);

const all_files = new Set();
for (const r of results.filter(Boolean)) {
  for (const f of (r.fix && r.fix.files_edited) || []) all_files.add(f);
  for (const f of (r.apply && r.apply.files_edited) || []) all_files.add(f);
}

return {
  total: TASKS.length,
  fixed: results.filter(r => r && r.fix && (r.fix.files_edited || []).length > 0 && !r.skipped).length,
  skipped: results.filter(r => r && r.skipped).length,
  files_edited: [...all_files],
  results: results.filter(Boolean).map(r => ({
    task: r.task,
    root_cause: ((r.fix && r.fix.root_cause) || "").slice(0, 200),
    files: (r.fix && r.fix.files_edited) || [],
    accepted: r.accepted,
    bugs: (r.bugs || []).length,
    skipped: r.skipped,
    skip_reason: (r.fix && r.fix.skip_reason) || "",
  })),
};
