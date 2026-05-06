export const meta = {
  name: "phase-d-unsafe-audit",
  description: "Audit unsafe { &mut *ptr } and *const→*mut casts. Per-file: classify → fix UB ones → 2-vote verify",
  phases: [
    { title: "Survey", detail: "grep all unsafe ptr derefs, group by file" },
    { title: "Audit", detail: "classify each: safe-single-owner / aliased-UB / should-be-UnsafeCell / restructure" },
    { title: "Verify", detail: "2-vote spec check on fixes" },
    { title: "Bugfix", detail: "apply verified bugs" },
  ],
};
const MAX_ROUNDS = (args && args.max_rounds) || 4;
const MAX_FILES = (args && args.max_files) || 200;
const PREFIX_RE = (args && args.prefix) || "";

const SURVEY_S = {
  type: "object",
  properties: {
    files: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string" },
          sites: {
            type: "array",
            items: {
              type: "object",
              properties: { line: { type: "number" }, kind: { type: "string" }, code: { type: "string" } },
              required: ["line", "kind"],
            },
          },
        },
        required: ["file", "sites"],
      },
    },
    total: { type: "number" },
  },
  required: ["files", "total"],
};
const AUDIT_S = {
  type: "object",
  properties: {
    file: { type: "string" },
    audited: { type: "number" },
    fixed: { type: "number" },
    classifications: { type: "object" },
    fns_touched: { type: "array", items: { type: "string" } },
    notes: { type: "string" },
  },
  required: ["file", "audited", "fixed"],
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
        required: ["fn", "what", "fix"],
      },
    },
  },
  required: ["file", "bugs"],
};
const BUGFIX_S = {
  type: "object",
  properties: { file: { type: "string" }, applied: { type: "number" } },
  required: ["file", "applied"],
};

const HARD = `**HARD RULES:** Never #[cfg(any())]/todo!(). Port REAL bodies from .zig. Never git reset/checkout/restore/stash. Never edit .zig. DO NOT run cargo. **Commit only:** \`git -c core.hooksPath=/dev/null add -A 'src/' && git -c core.hooksPath=/dev/null commit -q -m "phase-d(unsafe): <file>"\` — orchestrator pushes.`;

let history = [];
for (let round = 1; round <= MAX_ROUNDS; round++) {
  phase("Survey");
  const survey = await agent(
    `Survey unsafe ptr deref sites. Repo /root/bun-5. DO NOT edit.

Find all matches of:
- \`unsafe { &mut *\` (aliased-&mut risk) — kind="mut_deref"
- \`as *const\` followed by \`as *mut\` on same line (UB cast) — kind="const_to_mut_cast"
- \`unsafe { (*\` (raw deref) — kind="raw_deref" (lower priority)

\`grep -rn 'unsafe { &mut \\*\\|as \\*const.*as \\*mut' src/ --include='*.rs'\` (skip mut_deref/raw_deref for now — focus on const_to_mut_cast and the most-aliased &mut * patterns).

Group by file. ${PREFIX_RE ? `Only files matching \`^(${PREFIX_RE})\`.` : ""} Return {files:[{file, sites:[{line, kind, code}]}], total}.`,
    { label: `survey-r${round}`, phase: "Survey", schema: SURVEY_S },
  );
  if (!survey || survey.total === 0) return { rounds: round, history };

  const re = PREFIX_RE ? new RegExp("^(" + PREFIX_RE + ")") : null;
  const files = survey.files
    .filter(f => f.sites.length > 0 && (!re || re.test(f.file)))
    .sort((a, b) => b.sites.length - a.sites.length)
    .slice(0, MAX_FILES);
  log(`round ${round}: ${survey.total} sites across ${files.length} files`);

  const results = await pipeline(
    files,
    f =>
      agent(
        `Audit + fix unsafe ptr derefs in ${f.file}. Repo /root/bun-5 @ HEAD.

**Sites (${f.sites.length}):**
${f.sites
  .slice(0, 50)
  .map(s => `  L${s.line} [${s.kind}]: ${s.code || ""}`)
  .join("\n")}${f.sites.length > 50 ? `\n  ...(+${f.sites.length - 50})` : ""}

**For each site, classify + fix:**
1. **const_to_mut_cast** (\`as *const T as *mut T\`): ALWAYS UB if written through. Fix: change source to take \`&mut self\` / \`*mut T\`, or wrap field in \`UnsafeCell<T>\` if interior-mut is intended.
2. **mut_deref aliased** (\`&mut *ptr\` while another \`&mut\` to same alloc is live): UB. Fix per .zig spec — Zig's \`*T\` freely aliases; Rust needs either (a) raw-ptr-only access (no \`&mut\` materialized), (b) \`UnsafeCell\`, (c) restructure so only one \`&mut\` exists.
3. **safe-single-owner**: ptr is uniquely owned at this point, no overlap. Leave as-is, add \`// SAFETY:\` comment if missing.

Read .zig spec at \`${f.file.replace(".rs", ".zig")}\` for the original aliasing intent. Fix the UB ones. Commit. Record fns touched + classification counts.

${HARD}

Return {file, audited:N, fixed:N, classifications:{const_to_mut_cast:N, aliased_ub:N, safe:N, restructured:N}, fns_touched:[...], notes}.`,
        { label: `audit:${f.file.split("/").slice(-2).join("/")}`, phase: "Audit", schema: AUDIT_S },
      ),
    (audit, f) =>
      audit && (audit.fns_touched || []).length > 0
        ? parallel(
            [0, 1].map(
              i => () =>
                agent(
                  `Verify ${f.file} unsafe-ptr fixes against .zig spec. Repo /root/bun-5. Touched: ${(audit.fns_touched || []).slice(0, 30).join(", ")}. Find: remaining aliased-&mut, *const→*mut writes, missing SAFETY comments, over-correction (added UnsafeCell where single-owner was fine). Cite .zig:line + .rs:line. DEFAULT refuted. DO NOT edit. Return {file, bugs:[{fn,what,fix}]}.`,
                  { label: `v${i}:${f.file.split("/").pop()}`, phase: "Verify", schema: VERIFY_S },
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
            return { file: f.file, audit, bugs };
          })
        : { file: f.file, audit, bugs: [] },
    (vr, f) =>
      vr && vr.bugs && vr.bugs.length > 0
        ? agent(
            `Apply bugs to ${f.file}. Bugs:\n${vr.bugs.map((b, i) => `${i + 1}. ${b.fn}: ${b.what}\n FIX: ${b.fix}`).join("\n")}\nApply, commit. ${HARD}\nReturn {file, applied:N}.`,
            { label: `bf:${f.file.split("/").pop()}`, phase: "Bugfix", schema: BUGFIX_S },
          ).then(bf => ({ ...vr, bugfix: bf }))
        : vr,
  );
  const fixed = results.reduce((s, r) => s + ((r && r.audit && r.audit.fixed) || 0), 0);
  const bugs = results.reduce((s, r) => s + ((r && r.bugs && r.bugs.length) || 0), 0);
  history.push({ round, total: survey.total, files: files.length, fixed, bugs });
}
return { rounds: MAX_ROUNDS, history };
