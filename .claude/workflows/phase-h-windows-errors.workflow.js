export const meta = {
  name: "phase-h-windows-errors",
  description:
    "Get `cargo check -p bun_bin --target x86_64-pc-windows-msvc` to 0 errors. Survey → per-file errfiles → fix-agents (NO cargo) → loop.",
  phases: [
    { title: "Survey", detail: "fresh cargo check -p bun_bin → per-file errfiles" },
    { title: "Fix", detail: "one agent per file (Edit only, no cargo)" },
  ],
};

const A = typeof args === "string" ? JSON.parse(args) : args || {};
const WT = A.worktree || "/root/bun-5-cross-warn";
const TARGET = A.target || "x86_64-pc-windows-msvc";
const MAX_ROUNDS = A.max_rounds || 12;

const SURVEY_S = {
  type: "object",
  properties: {
    units: {
      type: "array",
      items: {
        type: "object",
        properties: { file: { type: "string" }, n: { type: "number" }, errfile: { type: "string" } },
        required: ["file", "n", "errfile"],
      },
    },
    total: { type: "number" },
    failing_crates: { type: "array", items: { type: "string" } },
  },
  required: ["units", "total"],
};
const FIX_S = {
  type: "object",
  properties: {
    file: { type: "string" },
    before: { type: "number" },
    fns_touched: { type: "array", items: { type: "string" } },
    notes: { type: "string" },
  },
  required: ["file"],
};

const HARD = `**HARD RULES:** Work ONLY in ${WT}. Edit files via Edit tool. **DO NOT run cargo** (orchestrator does the survey). **DO NOT** git reset/checkout/stash/rebase/pull/push. Commit only: \`cd ${WT} && git -c core.hooksPath=/dev/null add -A 'src/' && git -c core.hooksPath=/dev/null commit -q -m "win: <file> <what>"\`. Never \`#[cfg(any())]\`/\`todo!()\`. Read .zig spec at same path. NEW unsafe only if FFI-adjacent + SAFETY comment.`;

let history = [];
for (let round = 1; round <= MAX_ROUNDS; round++) {
  phase("Survey");
  const D = `/tmp/win-r${round}`;
  const survey = await agent(
    `Survey Windows compile errors. Repo ${WT}. Target ${TARGET}.

1. \`rm -rf ${D} && mkdir -p ${D}\`
2. **Clean the leaf crate first** (so cached rmeta doesn't hide errors): \`cd ${WT} && cargo clean -p bun_runtime -p bun_bin --target ${TARGET} 2>&1 | tail -1\`
3. \`cd ${WT} && cargo check -p bun_bin --target ${TARGET} 2>&1 > ${D}/full.log\`
4. total = \`grep -cE '^error\\[' ${D}/full.log\`
5. failing_crates = \`grep 'could not compile' ${D}/full.log | sed 's/.*compile \\\`//;s/\\\`.*//'\`
6. Per-file: \`grep -oP '\\-\\-> \\Ksrc/[^:]+\\.rs' ${D}/full.log | sort | uniq -c | sort -rn\`
7. Write per-file error blocks: for each file, \`awk -v f="<file>" 'BEGIN{RS="\\n\\n"} index($0,"--> "f":"){print $0"\\n"}' ${D}/full.log > ${D}/<slug>.err\`

Return {units:[{file,n,errfile}], total, failing_crates}. DO NOT edit src/.`,
    { label: `survey-r${round}`, phase: "Survey", schema: SURVEY_S },
  );
  if (!survey) {
    history.push({ round, error: "survey failed" });
    continue;
  }
  if (survey.total === 0) return { rounds: round, done: true, history, target: TARGET };

  const units = survey.units.filter(u => u.n > 0).sort((a, b) => b.n - a.n);
  log(`r${round}: ${survey.total} errors across ${units.length} files (${(survey.failing_crates || []).join(",")})`);

  phase("Fix");
  await parallel(
    units.map(
      u => () =>
        agent(
          `Fix ${u.n} Windows compile errors in **${u.file}**. Repo ${WT}. Target ${TARGET}.

**Errfile:** \`cat ${u.errfile}\` (DO NOT run cargo)

**Process:**
1. Read errfile + ${u.file} + .zig spec at same path (the .zig is the source of truth for Windows behavior).
2. Common patterns:
   - **E0308 mismatched types**: usually \`u32\` vs \`i32\` (Windows DWORD/int), \`*mut\` vs \`NonNull\`, \`Fd\` vs \`HANDLE\`. Match the .zig spec's type. Use \`.cast()\`/\`.into()\`/\`.native()\` where appropriate.
   - **E0609 no field**: Windows variant of struct has different fields. Check the \`#[cfg(windows)]\` struct decl.
   - **E0599 no method**: Windows impl missing the method. Port it from .zig (don't stub).
   - **E0061 arg count**: Windows fn signature differs. Match .zig.
   - **\`?\` on non-Try**: Windows fn returns plain T not Result. Match .zig (Zig's Maybe vs plain).
3. **NO** \`#[cfg(any())]\`/\`todo!()\`/\`unreachable!()\` for live code paths. PORT THE REAL BODY.
4. If a method/type is missing on a shared type (e.g. \`WindowsBufferedWriter::close\`), ADD it (in its file) from .zig spec.
5. Commit.

${HARD}

Return {file:"${u.file}", before:${u.n}, fns_touched:[...], notes}.`,
          { label: `fix:${u.file.replace("src/", "")}`, phase: "Fix", schema: FIX_S },
        ),
    ),
  );

  history.push({ round, total: survey.total, files: units.length });
}
return { rounds: MAX_ROUNDS, done: false, history, target: TARGET };
