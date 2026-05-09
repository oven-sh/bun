export const meta = {
  name: "phase-h-portnotes-survey",
  description:
    "Survey all PORT NOTE/TODO(port) → classify {explanatory, borrowck-workaround, lifetime-erasure, missing-idiom, known-TODO} → propose architectural refactors → 2-vote review → aggregate to docs/PORT_NOTES_PLAN.md",
  phases: [
    { title: "Shard", detail: "split src/ crates into shards" },
    { title: "Classify", detail: "per-crate: classify each PORT NOTE, propose refactor for architectural ones" },
    { title: "Review", detail: "2-vote per crate proposal set" },
    { title: "Synthesize", detail: "aggregate into docs/PORT_NOTES_PLAN.md" },
  ],
};

const A = typeof args === "string" ? JSON.parse(args) : args || {};
const REPO = A.repo || "/root/bun-5-portnotes";
// Crates with most PORT NOTEs (from survey). Each becomes one classify-agent.
const CRATES = A.crates || [
  "runtime",
  "jsc",
  "css",
  "install",
  "sql",
  "bundler",
  "js_parser",
  "http",
  "sql_jsc",
  "string",
  "uws_sys",
  "sys",
  "collections",
  "bun_core",
  "resolver",
  "io",
  "uws",
  "shell_parser",
  "js_printer",
  "ptr",
];

const CLASSIFY_S = {
  type: "object",
  properties: {
    crate: { type: "string" },
    total: { type: "number" },
    by_category: {
      type: "object",
      properties: {
        explanatory: { type: "number" },
        borrowck_workaround: { type: "number" },
        lifetime_erasure: { type: "number" },
        missing_idiom: { type: "number" },
        bitwise_copy_hazard: { type: "number" },
        known_todo: { type: "number" },
        other: { type: "number" },
      },
    },
    refactors: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          category: { type: "string" },
          affected_count: { type: "number" },
          example_file: { type: "string" },
          recipe: { type: "string" },
          effort: { type: "string" },
          unsafe_removed_est: { type: "number" },
        },
        required: ["title", "category", "affected_count", "recipe", "effort"],
      },
    },
  },
  required: ["crate", "total", "by_category", "refactors"],
};
const REVIEW_S = {
  type: "object",
  properties: {
    crate: { type: "string" },
    accept: { type: "boolean" },
    feedback: {
      type: "array",
      items: {
        type: "object",
        properties: { refactor_title: { type: "string" }, what: { type: "string" }, fix: { type: "string" } },
        required: ["refactor_title", "what"],
      },
    },
  },
  required: ["crate", "accept", "feedback"],
};

phase("Classify");
log(`classifying ${CRATES.length} crates`);
const classified = await pipeline(
  CRATES,
  c =>
    agent(
      `Classify ALL \`PORT NOTE\` / \`TODO(port)\` comments in **src/${c}/**. Repo ${REPO}. READ ONLY — no edits, no build, no git.

**Step 1**: \`grep -rn 'PORT NOTE\\|TODO(port)' ${REPO}/src/${c}/ --include='*.rs'\` — read each (and ~5 lines of context).

**Step 2**: Classify each into ONE of:
- **explanatory** — documents a porting decision; no action needed (e.g. "Zig used X, Rust uses Y because Z")
- **borrowck_workaround** — code reshaped/reordered/split-borrow to satisfy borrowck; the original Zig shape was simpler ("reshaped for borrowck", "split borrow", "reborrow before…")
- **lifetime_erasure** — uses \`'static\` / \`*const [u8]\` / \`detach_lifetime\` as a placeholder for an unthreaded lifetime ("Phase B threads 'bump", "JSC_BORROW", "&'static for Phase A")
- **missing_idiom** — should be a standard Rust idiom: derive(Clone), impl Drop, From/Into, Iterator, MutexGuard RAII, Display, etc. ("Zig had no Drop so…", "manual deinit because…")
- **bitwise_copy_hazard** — bitwise struct copy/ptr::copy of Drop-carrying type ("Zig flat-copied; Rust must…", "no NRVO so…")
- **known_todo** — explicitly unfinished work
- **other** — doesn't fit above

**Step 3**: For each NON-explanatory category, identify CLUSTERS (same workaround pattern repeated ≥3 times). For each cluster, propose ONE refactor:
- **title**: e.g. "Thread \`'bump\` lifetime through CSS values"
- **category**: which classification
- **affected_count**: how many PORT NOTEs would be deleted
- **example_file**: one representative file:line
- **recipe**: 2-4 sentences. What's the idiomatic-Rust replacement? Which trait/type/macro? Breaking change scope?
- **effort**: S (one file, <1hr) / M (one crate, <day) / L (cross-crate, >day) / XL (architectural)
- **unsafe_removed_est**: rough count of \`unsafe\` blocks this would eliminate

Aim for 3-10 high-value refactors per crate. SKIP one-off explanatory notes.

Return {crate:"${c}", total:N, by_category:{...}, refactors:[...]}.`,
      { label: `classify:${c}`, phase: "Classify", schema: CLASSIFY_S },
    ),
  (cls, c) =>
    cls && (cls.refactors || []).length > 0
      ? parallel(
          [0, 1].map(
            i => () =>
              agent(
                `Adversarially review refactor proposals for **src/${c}/**. Repo ${REPO}.

Proposals (${cls.refactors.length}):
${cls.refactors.map((r, j) => `${j + 1}. [${r.effort}] **${r.title}** (${r.category}, ~${r.affected_count} sites): ${r.recipe}`).join("\n")}

**For each, check:**
- Is the recipe ACTUALLY more idiomatic, or does it trade one workaround for another?
- Is the effort estimate realistic (read example_file)?
- Would it introduce perf regression (e.g. lifetime params on hot-path generics → monomorphization bloat)?
- Is there a simpler/better approach the proposer missed?
- Is it duplicate of a known pattern (BackRef, RawSlice, top_scope!, RefPtr, link_interface!) that already exists?

DEFAULT accept:true. List feedback for proposals that need correction.

DO NOT edit/build. Return {crate:"${c}", accept, feedback:[{refactor_title, what, fix}]}.`,
                { label: `rev${i}:${c}`, phase: "Review", schema: REVIEW_S },
              ),
          ),
        ).then(votes => {
          const fb = (votes || []).filter(Boolean).flatMap(v => v.feedback || []);
          return { crate: c, cls, feedback: fb };
        })
      : { crate: c, cls, feedback: [] },
);

phase("Synthesize");
const synth = await agent(
  `Synthesize PORT NOTE refactor plan. Write \`${REPO}/docs/PORT_NOTES_PLAN.md\`. Input:

${JSON.stringify(
  classified.filter(Boolean).map(r => ({
    crate: r.crate,
    total: r.cls && r.cls.total,
    by_category: r.cls && r.cls.by_category,
    refactors: ((r.cls && r.cls.refactors) || []).map(x => ({ ...x, recipe: x.recipe.slice(0, 200) })),
    feedback: r.feedback.slice(0, 5),
  })),
  null,
  2,
).slice(0, 60000)}

**Structure the plan as:**
1. **Summary table**: total PORT NOTEs by category across all crates
2. **Cross-cutting refactors** (apply across many crates) — sorted by (unsafe_removed_est × affected_count / effort). Dedup proposals that are the same pattern in different crates. For each: title, recipe, affected crates, effort, unsafe-reduction estimate, reviewer feedback incorporated.
3. **Per-crate refactors** (crate-specific) — same fields.
4. **Recommended order**: which to do first (highest leverage, lowest risk).

Write the file via the Write tool. Then commit: \`cd ${REPO} && git -c core.hooksPath=/dev/null add docs/PORT_NOTES_PLAN.md && git -c core.hooksPath=/dev/null commit -q -m "docs: PORT_NOTES_PLAN.md (architectural refactor survey)"\`.

Return {written: bool, path, refactor_count, top_5_titles:[...]}.`,
  {
    label: "synthesize",
    phase: "Synthesize",
    schema: {
      type: "object",
      properties: {
        written: { type: "boolean" },
        path: { type: "string" },
        refactor_count: { type: "number" },
        top_5_titles: { type: "array", items: { type: "string" } },
      },
      required: ["written", "refactor_count"],
    },
  },
);

return {
  total_crates: CRATES.length,
  total_notes: classified.filter(Boolean).reduce((s, r) => s + ((r.cls && r.cls.total) || 0), 0),
  refactor_count: synth && synth.refactor_count,
  top_5: synth && synth.top_5_titles,
  by_crate: classified.filter(Boolean).map(r => ({
    crate: r.crate,
    total: r.cls && r.cls.total,
    by_category: r.cls && r.cls.by_category,
    refactors: ((r.cls && r.cls.refactors) || []).length,
  })),
  plan_path: synth && synth.path,
};
