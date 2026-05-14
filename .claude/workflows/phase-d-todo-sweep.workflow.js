export const meta = {
  name: "phase-d-todo-sweep",
  description:
    "Find all todo!()/unimplemented!() → group by file → implement from .zig → 2-vote verify-until-dry → bugfix",
  phases: [
    { title: "Survey", detail: "grep all todo!() → group by file" },
    { title: "Implement", detail: "port each todo!() body from .zig spec" },
    { title: "Verify", detail: "2-vote spec check, loop until no new bugs" },
    { title: "Bugfix", detail: "apply verified bugs" },
  ],
};

const MAX_ROUNDS = (args && args.max_rounds) || 6;
const MAX_FILES = (args && args.max_files) || 250;
const PREFIX_RE = (args && args.prefix) || ""; // shard regex e.g. "src/runtime/"

const SURVEY_S = {
  type: "object",
  properties: {
    files: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string" },
          n: { type: "number" },
          sites: {
            type: "array",
            items: {
              type: "object",
              properties: { line: { type: "number" }, msg: { type: "string" }, fn: { type: "string" } },
              required: ["line"],
            },
          },
        },
        required: ["file", "n", "sites"],
      },
    },
    total: { type: "number" },
  },
  required: ["files", "total"],
};
const IMPL_S = {
  type: "object",
  properties: {
    file: { type: "string" },
    before: { type: "number" },
    after: { type: "number" },
    fns_implemented: { type: "array", items: { type: "string" } },
    files_touched: { type: "array", items: { type: "string" } },
    notes: { type: "string" },
  },
  required: ["file", "after", "fns_implemented"],
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

const HARD = `**HARD RULES:** Never #[cfg(any())]/todo!()/unimplemented!() — port REAL bodies from .zig. Never git reset/checkout/restore/stash. Never edit .zig. DO NOT run cargo. **Commit only (NO push, NO pull):** \`git -c core.hooksPath=/dev/null add -A "src/" && git -c core.hooksPath=/dev/null commit -q -m "phase-d: <what>"\` — orchestrator pushes.`;

let history = [];
let seen = {};

for (let round = 1; round <= MAX_ROUNDS; round++) {
  phase("Survey");
  const survey = await agent(
    `Survey all todo!()/unimplemented!() sites. Repo /root/bun-5. DO NOT edit.

\`grep -rn 'todo!(\\|unimplemented!(' src/ --include='*.rs'\` → for each match, capture file:line + the message string (if any). Find the enclosing fn name (look upward for \`fn <name>\` / \`pub fn <name>\`).

**SHARD FILTER:** Only include files whose path matches regex \`^(${PREFIX_RE || ".*"}

Group by file. Return {files:[{file, n, sites:[{line, msg, fn}]}], total}. Skip src/bun_bin/phase_c_exports.rs.`,
    { label: `survey-r${round}`, phase: "Survey", schema: SURVEY_S },
  );
  if (!survey || survey.total === 0) {
    log(`round ${round}: 0 todo!() remaining`);
    return { rounds: round, done: true, history };
  }

  const re = PREFIX_RE ? new RegExp("^(" + PREFIX_RE + ")") : null;
  const files = survey.files
    .filter(f => f.n > 0 && !f.file.includes("phase_c_exports") && (!re || re.test(f.file)))
    .sort((a, b) => {
      const sa = seen[a.file] || 0,
        sb = seen[b.file] || 0;
      if (sa !== sb) return sa - sb;
      return b.n - a.n;
    })
    .slice(0, MAX_FILES);
  for (const f of files) seen[f.file] = (seen[f.file] || 0) + 1;

  log(`round ${round}: ${survey.total} todo!() across ${files.length} files`);

  const results = await pipeline(
    files,
    // Stage 1: implement
    f =>
      agent(
        `Implement ALL ${f.n} todo!()/unimplemented!() in ONE file by porting from .zig spec. Repo /root/bun-5 @ HEAD.

**File:** ${f.file}
**Spec:** \`${f.file.replace(/\.rs$/, ".zig")}\` (or nearest .zig — grep for the fn name)
**Sites:**
${f.sites.map(s => `  L${s.line} ${s.fn ? `(${s.fn})` : ""}: ${s.msg || "(bare)"}`).join("\n")}
${seen[f.file] > 1 ? `**Seen ${seen[f.file]}× — likely missing upstream symbol or hard port.**` : ""}

**Process:**
1. For each site: find the fn in the .zig spec (same path, or grep src/**/*.zig for fn name).
2. Port the REAL body. Adapt API per docs/PORTING.md (idiom map, §Forbidden patterns).
3. **Missing upstream symbol** (the \`blocked_on:\` pattern): GO ADD that symbol to its crate. If it's a dep-cycle: MOVE the code to the right crate.
4. **codegen todo!()**: implement the proc-macro output or hand-write what it would emit.
5. After: \`grep -c 'todo!(\\|unimplemented!(' ${f.file}\` → target 0. Commit.

${HARD}

Return {file, before:${f.n}, after:N, fns_implemented:[...], files_touched:[...], notes}.`,
        { label: `impl:${f.file.split("/").slice(-2).join("/")}`, phase: "Implement", schema: IMPL_S },
      ),
    // Stage 2: verify-until-dry (2-vote, then re-run if new bugs found, max 3 iterations)
    async (impl, f) => {
      if (!impl || (impl.fns_implemented || []).length === 0) return { file: f.file, impl, bugs: [] };
      let allBugs = [];
      let known = {};
      for (let iter = 0; iter < 3; iter++) {
        const votes = await parallel(
          [0, 1].map(
            i => () =>
              agent(
                `Adversarially verify ${f.file} against .zig spec. Repo /root/bun-5 @ HEAD.

Implemented fns: ${(impl.fns_implemented || []).slice(0, 40).join(", ")}${(impl.fns_implemented || []).length > 40 ? ` (+${impl.fns_implemented.length - 40})` : ""}. Read each in .rs + .zig spec at same path. Find: spec divergences (logic-bug), silent-no-ops, aliased-&mut, transmute-to-enum, mem::forget/Box::leak for &'static, missing match arms, ptr::read of Drop type, wrong-discriminant. Check docs/PORTING.md §Forbidden.
${allBugs.length > 0 ? `\nPrior iteration found ${allBugs.length} bugs (already known). Find DIFFERENT ones.` : ""}

DEFAULT TO refuted — cite .zig:line + .rs:line + observable divergence. DO NOT edit. DO NOT run cargo.

Return {file, bugs:[{fn, what, fix, severity}]}.`,
                { label: `verify${iter}.${i}:${f.file.split("/").pop()}`, phase: "Verify", schema: VERIFY_S },
              ),
          ),
        );
        const fresh = (votes || []).filter(Boolean).flatMap(v => v.bugs || []);
        let newCount = 0;
        for (const b of fresh) {
          const k = `${b.fn}::${(b.what || "").slice(0, 80)}`;
          if (!known[k]) {
            known[k] = 1;
            allBugs.push(b);
            newCount++;
          }
        }
        if (newCount === 0) break;
      }
      return { file: f.file, impl, bugs: allBugs };
    },
    // Stage 3: bugfix
    (vr, f) =>
      vr && vr.bugs && vr.bugs.length > 0
        ? agent(
            `Apply verified bugs to ${f.file}. Repo /root/bun-5 @ HEAD.

Verified bugs (2-vote-until-dry against .zig):
${vr.bugs.map((b, i) => `${i + 1}. **${b.fn}** (${b.severity || "logic-bug"}): ${b.what}\n   FIX: ${b.fix}`).join("\n")}

Apply each. Read .zig spec to confirm. Edit ${f.file} (and upstream if a fix requires it). Commit. DO NOT run cargo.

${HARD}

Return {file, applied:N, notes}.`,
            { label: `bugfix:${f.file.split("/").pop()}`, phase: "Bugfix", schema: BUGFIX_S },
          ).then(bf => ({ ...vr, bugfix: bf }))
        : vr,
  );

  const after = results.reduce((s, r) => s + ((r && r.impl && r.impl.after) || 0), 0);
  const bugs = results.reduce((s, r) => s + ((r && r.bugs && r.bugs.length) || 0), 0);
  history.push({ round, total: survey.total, files: files.length, todos_after: after, bugs_found: bugs });
}
return { rounds: MAX_ROUNDS, done: false, history };
