export const meta = {
  name: "phase-h-main-parity",
  description:
    "For each main commit touching .zig since port started: verify the .rs equivalent has the same fix; port if missing.",
  phases: [
    { title: "Survey", detail: "list main .zig commits since port branch-point" },
    { title: "Check", detail: "per-commit: does .rs have the fix? (read .zig diff + .rs file)" },
    { title: "Verify", detail: "2-vote adversarial: is the parity verdict correct?" },
    { title: "Port", detail: "apply missing fixes to .rs, build, commit" },
  ],
};

const A = typeof args === "string" ? JSON.parse(args) : args || {};
const WT = A.worktree || "/Users/alistair/code/bun";
// Branch-point: parent of first .rs commit on the port branch.
const SINCE = A.since || "c241df2861c6";
const MAIN = A.main || "origin/main";
// Default: report only. Pass {apply:true} to actually port+commit (use a worktree!).
const APPLY = A.apply === true;

const SURVEY_S = {
  type: "object",
  properties: {
    commits: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sha: { type: "string" },
          subject: { type: "string" },
          zig_files: { type: "array", items: { type: "string" } },
        },
        required: ["sha", "subject", "zig_files"],
      },
    },
  },
  required: ["commits"],
};

const CHECK_S = {
  type: "object",
  properties: {
    sha: { type: "string" },
    verdict: { type: "string", enum: ["ported", "missing", "not-applicable", "partial"] },
    rs_files: { type: "array", items: { type: "string" } },
    evidence: { type: "string", description: "file:line in .rs proving presence, or what's missing" },
    port_recipe: { type: "string", description: "if missing/partial: exact change needed in .rs" },
  },
  required: ["sha", "verdict", "evidence"],
};

const VOTE_S = {
  type: "object",
  properties: {
    agree: { type: "boolean" },
    correction: { type: "string" },
  },
  required: ["agree"],
};

const PORT_S = {
  type: "object",
  properties: {
    sha: { type: "string" },
    applied: { type: "boolean" },
    commit: { type: "string" },
    files_touched: { type: "array", items: { type: "string" } },
    build_ok: { type: "boolean" },
    notes: { type: "string" },
  },
  required: ["sha", "applied", "build_ok"],
};

phase("Survey");
const survey = await agent(
  `cd ${WT}. List every commit in \`${SINCE}..${MAIN}\` that touched \`src/**/*.zig\`. ` +
    `For each, return sha (short), subject line, and the list of .zig files it changed. ` +
    `Use: git log --format='%h %s' ${SINCE}..${MAIN} -- 'src/**/*.zig' and git diff-tree --no-commit-id --name-only -r <sha> -- 'src/**/*.zig'.`,
  { label: "survey-main-zig-commits", schema: SURVEY_S },
);
log(`${survey.commits.length} main .zig commits to check`);

const results = await pipeline(
  survey.commits,
  // Check: does .rs have the fix?
  c =>
    agent(
      `cd ${WT}. Main commit ${c.sha} "${c.subject}" changed: ${c.zig_files.join(", ")}.\n` +
        `1. Read the .zig diff: git show ${c.sha} -- ${c.zig_files.map(f => `'${f}'`).join(" ")}\n` +
        `2. Map each .zig path to its .rs equivalent (same dir, .zig→.rs; if moved, rg for the type/fn name).\n` +
        `3. Read the .rs file(s) and determine if the SAME semantic change is present.\n` +
        `4. Verdict: "ported" (fix present, cite .rs file:line), "missing" (fix absent — give port_recipe), ` +
        `"partial" (some hunks ported), or "not-applicable" (Zig-specific code with no .rs equivalent — e.g. allocator plumbing, comptime).\n` +
        `Be precise: a .zig→.rs git merge does NOT port the fix — only an explicit .rs change does.`,
      { label: `check:${c.sha}`, phase: "Check", schema: CHECK_S },
    ),
  // Verify: 2-vote adversarial on the verdict
  async (check, c) => {
    const votes = await parallel(
      Array.from(
        { length: 2 },
        (_, i) => () =>
          agent(
            `cd ${WT}. ADVERSARIAL VERIFY. A checker claims main commit ${c.sha} "${c.subject}" has parity verdict ` +
              `"${check.verdict}" with evidence: ${check.evidence}.\n` +
              `Your job: try to REFUTE. Read git show ${c.sha} and the .rs files ${(check.rs_files || []).join(", ")}. ` +
              `If verdict="ported" but the .rs logic differs in a way that changes behavior → agree=false. ` +
              `If verdict="missing" but you find the fix in .rs → agree=false. Default to agree=false if uncertain.`,
            { label: `verify:${c.sha}:v${i}`, phase: "Verify", schema: VOTE_S },
          ),
      ),
    );
    const agreed = votes.filter(v => v.agree).length;
    return { ...check, subject: c.subject, votes, confirmed: agreed >= 1 };
  },
);

const missing = results.filter(r => r.confirmed && (r.verdict === "missing" || r.verdict === "partial"));
log(`${missing.length} commits need porting`);

phase("Port");
const ported = !APPLY
  ? []
  : await pipeline(missing, m =>
      agent(
        `cd ${WT}. Port main commit ${m.sha} "${m.subject}" to Rust.\n` +
          `Zig diff: git show ${m.sha}\nTarget .rs files: ${(m.rs_files || []).join(", ")}\n` +
          `Recipe from checker: ${m.port_recipe || "(derive from diff)"}\n` +
          `Apply the equivalent change to .rs. Match surrounding idiom (Cell/Maybe/etc). ` +
          `**ALSO port the test/ hunks** from the same commit (git show ${m.sha} -- test/ | git apply --3way) — ` +
          `the .zig commit's test changes are usually .ts/.js and apply directly. Skipping them = CI [new] failures. ` +
          `Then: cargo check --workspace 2>&1 | tail -20. ` +
          `Then: git add -u && git commit -m "port ${m.sha}: <subject> (.zig→.rs parity)". ` +
          `Return commit sha, files touched, build_ok.`,
        { label: `port:${m.sha}`, phase: "Port", schema: PORT_S },
      ),
    );

return {
  checked: results.length,
  by_verdict: results.reduce((a, r) => ((a[r.verdict] = (a[r.verdict] || 0) + 1), a), {}),
  disputed: results.filter(r => !r.confirmed).map(r => ({ sha: r.sha, verdict: r.verdict })),
  ported: ported.filter(Boolean),
  table: results.map(r => ({
    sha: r.sha,
    subject: r.subject,
    verdict: r.verdict,
    confirmed: r.confirmed,
    evidence: r.evidence,
  })),
};
