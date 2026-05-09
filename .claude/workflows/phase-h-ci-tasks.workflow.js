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

const HARD = `**HARD RULES (per-agent):** READ-ONLY analysis + Edit src/ files. **DO NOT** run \`cargo\`, \`bun bd\`, \`bun test\`, \`bun build\`, or ANY build/exec/spawn command (parallel agents would race). **DO NOT** use git (commit/reset/checkout/stash/pull/push/diff). Edit files via the Edit tool ONLY; the orchestrator commits. NO new unsafe outside FFI. Read .zig spec for the matching file. If the task is a duplicate / known debug-artifact / needs test/ edit (forbidden) — set skipped:true + skip_reason and edit nothing.`;

phase("Fix");
log(`processing ${TASKS.length} tasks`);
const results = await pipeline(
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
  (vr, t) =>
    vr && !vr.skipped && !vr.accepted && vr.bugs && vr.bugs.length > 0
      ? agent(
          `Apply reviewer corrections for **${t.id}**. Original fix touched: ${JSON.stringify((vr.fix || {}).files_edited)}.

**${vr.bugs.length} reviewer findings:**
${vr.bugs.map((b, i) => `${i + 1}. [${b.severity}] **${b.file}**: ${b.what}\n   WHY: ${b.why_wrong}\n   FIX: ${b.fix}`).join("\n")}

Edit the files to apply each correction. ${HARD}

Return {task:"${t.id}", applied:N, files_edited:[...]}.`,
          { label: `apply:${t.id}`, phase: "Apply", schema: APPLY_S },
        ).then(a => ({ ...vr, apply: a }))
      : vr,
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
