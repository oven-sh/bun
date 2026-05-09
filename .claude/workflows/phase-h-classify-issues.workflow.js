export const meta = {
  name: "phase-h-classify-issues",
  description:
    "Classify crash/leak GitHub issue candidates. Per-issue agent reads JSON → classifies {crash,leak,oom,hang,uaf,not-memory} + extracts repro/version/area. Synth writes docs/CRASH_LEAK_ISSUES.md tracking table. NO GitHub mutations.",
  phases: [
    { title: "Classify", detail: "1 agent per ~20 issues batch" },
    { title: "Synth", detail: "write tracking markdown + CSV" },
  ],
};

const A = typeof args === "string" ? JSON.parse(args) : args || {};
const REPO = A.repo || "/root/bun-5";
const INDEX_PATH = A.index_path || `${REPO}/tmp/crash-leak-issues/index.json`;
const BATCH = A.batch_size || 20;

// Load index via a tiny agent (workflows can't read fs directly).
const _idx = await agent(
  `Read \`${INDEX_PATH}\` and return its contents verbatim as {issues: [...]}. DO NOT edit anything.`,
  {
    label: "load-index",
    phase: "Classify",
    schema: {
      type: "object",
      properties: {
        issues: {
          type: "array",
          items: {
            type: "object",
            properties: { number: { type: "number" }, title: { type: "string" }, path: { type: "string" } },
            required: ["number", "path"],
          },
        },
      },
      required: ["issues"],
    },
  },
);
const ISSUES = ((_idx && _idx.issues) || []).map(i => ({
  ...i,
  path: i.path.startsWith("/") ? i.path : `${REPO}/${i.path}`,
}));
if (!ISSUES.length) throw new Error(`no issues loaded from ${INDEX_PATH}`);

const CLS_S = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          number: { type: "number" },
          category: {
            type: "string",
            enum: [
              "crash",
              "leak",
              "oom",
              "hang",
              "uaf",
              "double-free",
              "assert",
              "not-memory",
              "duplicate",
              "needs-repro",
            ],
          },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          area: { type: "string" },
          version: { type: "string" },
          has_repro: { type: "boolean" },
          summary: { type: "string" },
          likely_fixed_by_port: { type: "boolean" },
          fixed_by_reason: { type: "string" },
        },
        required: ["number", "category", "confidence"],
      },
    },
  },
  required: ["results"],
};

// Batch issues into groups of ~20 (one agent per batch keeps context manageable).
const batches = [];
for (let i = 0; i < ISSUES.length; i += BATCH) batches.push(ISSUES.slice(i, i + BATCH));

phase("Classify");
log(`classifying ${ISSUES.length} candidates in ${batches.length} batches`);
const classified = await parallel(
  batches.map(
    (b, idx) => () =>
      agent(
        `Classify ${b.length} GitHub issues as crash/leak/etc. READ ONLY — NO GitHub mutations, NO edits.

**Issues** (read each JSON file for full body+labels+comments):
${b.map(i => `- #${i.number} "${i.title}" — \`cat ${i.path}\``).join("\n")}

**For each, decide:**
- **category**:
  - crash — SIGSEGV/SIGBUS/SIGILL/SIGABRT, "Bun has crashed", panic with backtrace
  - leak — memory grows unbounded over time/iterations (RSS, heap)
  - oom — runs out of memory (one-shot, not gradual leak)
  - hang — process never exits / infinite loop
  - uaf — use-after-free / heap-use-after-free (ASAN report)
  - double-free
  - assert — assertion failure (not a memory bug per se)
  - not-memory — false positive (the word "crash"/"leak" appears but issue is about something else)
  - duplicate — body says "duplicate of #X" or comments confirm dup
  - needs-repro — no actionable repro
- **confidence**: high (clear backtrace/ASAN report)/medium (described but no trace)/low (vague)
- **area**: which Bun subsystem (fetch/http/bundler/install/fs/spawn/worker/sqlite/shell/test-runner/ffi/...)
- **version**: bun version mentioned (or "")
- **has_repro**: is there a runnable reproduction?
- **summary**: 1-line what crashes/leaks
- **likely_fixed_by_port**: would the Zig→Rust port plausibly have fixed this? TRUE if: it's a Zig-specific memory bug (alignment, undefined-on-error-path, missing deinit), an issue in code that was rewritten, or matches a bug class we've fixed (noalias re-entrancy, missing deref, bitwise-copy-of-Drop). FALSE if: it's in C++ (JSC/WebKit), a logic bug, or a feature gap.
- **fixed_by_reason**: 1-line why (or "")

Return {results:[{number,category,confidence,area,version,has_repro,summary,likely_fixed_by_port,fixed_by_reason}]}.`,
        { label: `cls:${idx}:${b[0].number}-${b[b.length - 1].number}`, phase: "Classify", schema: CLS_S },
      ),
  ),
);
const all = classified.filter(Boolean).flatMap(c => c.results || []);
log(`classified ${all.length} issues`);

phase("Synth");
const synth = await agent(
  `Write tracking report \`${REPO}/docs/CRASH_LEAK_ISSUES.md\` + \`${REPO}/tmp/crash-leak-issues.csv\`.

**Input** (${all.length} classified):
${JSON.stringify(all, null, 0).slice(0, 100000)}

**Structure CRASH_LEAK_ISSUES.md:**
1. Summary table: counts by category × confidence × likely_fixed_by_port
2. **Likely fixed by Rust port** (likely_fixed_by_port=true, sorted by area then number): | # | category | area | summary | reason |
3. **Needs verification** (high-confidence crash/leak/uaf, likely_fixed=false): same columns
4. **Not memory bugs** (not-memory/duplicate): brief list
5. By-area breakdown

**CSV columns**: number,category,confidence,area,version,has_repro,likely_fixed_by_port,summary,html_url

Write both files via Write tool. NO git commit (orchestrator does it). NO GitHub API calls.

Return {written:bool, md_path, csv_path, by_category:{...}, likely_fixed_count}.`,
  {
    label: "synth-report",
    phase: "Synth",
    schema: {
      type: "object",
      properties: {
        written: { type: "boolean" },
        md_path: { type: "string" },
        csv_path: { type: "string" },
        by_category: { type: "object" },
        likely_fixed_count: { type: "number" },
      },
      required: ["written", "by_category", "likely_fixed_count"],
    },
  },
);

return {
  total: ISSUES.length,
  classified: all.length,
  by_category: synth && synth.by_category,
  likely_fixed: synth && synth.likely_fixed_count,
  md_path: synth && synth.md_path,
  csv_path: synth && synth.csv_path,
};
