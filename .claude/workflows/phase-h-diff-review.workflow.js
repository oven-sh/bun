export const meta = {
  name: "phase-h-diff-review",
  description:
    "2-vote adversarial review of a diff range, per-file. Reviewers check vs .zig spec for UB/leaks/spec-divergence. Bugfix-agent applies findings.",
  phases: [
    { title: "Review", detail: "2 adversarial reviewers per changed file" },
    { title: "Fix", detail: "apply UB/leak/semantics findings" },
  ],
};

const A = typeof args === "string" ? JSON.parse(args) : args || {};
const WT = A.worktree || "/root/bun-5-win-review";
const FROM = A.from || "3c19af4986be";
const TO = A.to || "HEAD";
const FILES = A.files || []; // list of changed src/ files
if (!FILES.length) throw new Error("args.files required");
const TARGET = A.target || "x86_64-pc-windows-msvc";

const REVIEW_S = {
  type: "object",
  properties: {
    file: { type: "string" },
    accept: { type: "boolean" },
    bugs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          line: { type: "number" },
          what: { type: "string" },
          why_wrong: { type: "string" },
          fix: { type: "string" },
          severity: { type: "string", enum: ["ub", "leak", "semantics", "perf", "style"] },
        },
        required: ["what", "why_wrong", "severity"],
      },
    },
  },
  required: ["file", "accept", "bugs"],
};
const FIX_S = {
  type: "object",
  properties: { file: { type: "string" }, applied: { type: "number" }, notes: { type: "string" } },
  required: ["file", "applied"],
};

phase("Review");
log(`reviewing ${FILES.length} files in ${FROM}..${TO}`);
const reviewed = await pipeline(
  FILES,
  f =>
    parallel(
      [0, 1].map(
        i => () =>
          agent(
            `Adversarially review **${f}** for the Windows compile-fix diff. Repo ${WT}. Target ${TARGET}.

**Diff:** \`cd ${WT} && git diff ${FROM}..${TO} -- ${f}\` (read full context: also \`cat ${WT}/${f}\` and \`cat ${WT}/${f.replace(".rs", ".zig")}\` for spec).

**Check ONLY the changed regions** (lines touched by the diff):
1. **UB**: aliased \`&mut\` (re-entrancy via libuv callback while \`&mut self\` live)? Stacked-Borrows violation (raw deref while ref live)? \`mem::zeroed\` on type with non-zero niche? Uninit read?
2. **Leak**: Box/Vec/String allocated but no Drop path? \`Box::leak\`/\`into_raw\` without paired reclaim in callback? \`heap::take\` from a pointer that wasn't heap-allocated?
3. **Semantics**: diverges from .zig spec (different error handling, different field, wrong cast width)? Windows-specific behavior wrong (HANDLE vs Fd, DWORD signedness)?
4. **Non-FFI unsafe**: any new \`unsafe {}\` that's NOT wrapping a Win32/libuv extern call or raw-ptr field access? Those need scrutiny.

DEFAULT accept:true if no bugs. DO NOT edit/run.

Return {file:"${f}", accept, bugs:[{line, what, why_wrong, fix, severity}]}.`,
            { label: `rev${i}:${f.split("/").pop()}`, phase: "Review", schema: REVIEW_S },
          ),
      ),
    ).then(votes => {
      const all = (votes || []).filter(Boolean).flatMap(v => v.bugs || []);
      const seen = {};
      const bugs = all.filter(b => {
        const k = `${b.line || 0}::${(b.what || "").slice(0, 60)}`;
        if (seen[k]) return false;
        seen[k] = 1;
        return true;
      });
      const blocking = bugs.filter(b => ["ub", "leak", "semantics"].includes(b.severity));
      return { file: f, bugs, blocking };
    }),
  (vr, f) =>
    vr && vr.blocking && vr.blocking.length > 0
      ? agent(
          `Apply UB/leak/semantics fixes to **${f}**. Repo ${WT}.

**${vr.blocking.length} BLOCKING findings:**
${vr.blocking.map((b, i) => `${i + 1}. [${b.severity}] L${b.line || "?"}: ${b.what}\n   WHY: ${b.why_wrong}\n   FIX: ${b.fix}`).join("\n")}

Edit ${f} via Edit tool. Read .zig spec. NO new non-FFI unsafe. After: verify diff still makes sense.

Commit: \`cd ${WT} && git -c core.hooksPath=/dev/null add ${f} && git -c core.hooksPath=/dev/null commit -q -m "win-review: ${f} <what>"\`. NO push/reset.

Return {file:"${f}", applied:N, notes}.`,
          { label: `fix:${f.split("/").pop()}`, phase: "Fix", schema: FIX_S },
        ).then(a => ({ ...vr, fix: a }))
      : vr,
);

const blocking_count = reviewed.filter(Boolean).reduce((s, r) => s + (r.blocking || []).length, 0);
const all_bugs = reviewed.filter(Boolean).flatMap(r => (r.bugs || []).map(b => ({ file: r.file, ...b })));

return {
  files: FILES.length,
  blocking_count,
  total_bugs: all_bugs.length,
  blocking: all_bugs.filter(b => ["ub", "leak", "semantics"].includes(b.severity)),
  by_severity: {
    ub: all_bugs.filter(b => b.severity === "ub").length,
    leak: all_bugs.filter(b => b.severity === "leak").length,
    semantics: all_bugs.filter(b => b.severity === "semantics").length,
    perf: all_bugs.filter(b => b.severity === "perf").length,
    style: all_bugs.filter(b => b.severity === "style").length,
  },
  fixed: reviewed.filter(r => r && r.fix && r.fix.applied > 0).length,
};
