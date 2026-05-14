export const meta = {
  name: "phase-h-unsafe-wrap",
  description:
    "Exhaustive unsafe-reduction by pattern. Find/classify (sharded) → coalesce into strategies → apply per strategy → 2-vote review → final compile+fix. ~50M tokens. NO git/cargo until final.",
  phases: [
    { title: "Classify", detail: "30 shard-agents classify every unsafe{} into a pattern bucket" },
    { title: "Coalesce", detail: "synth: group patterns → propose 1 wrapper/abstraction per pattern" },
    { title: "Apply", detail: "per accepted strategy: apply across ALL matching sites (Edit only)" },
    { title: "Review", detail: "2-vote per strategy diff" },
    { title: "Compile", detail: "ONE agent: cargo check + fix + commit" },
  ],
};

const A = typeof args === "string" ? JSON.parse(args) : args || {};
const WT = A.worktree || "/root/bun-5-unsafe-wrap";
// Crates with most unsafe (file count). Shard top-heavy crates more finely.
const CRATES = A.crates || [
  "runtime",
  "jsc",
  "install",
  "css",
  "bundler",
  "js_parser",
  "http",
  "uws_sys",
  "sql_jsc",
  "bun_core",
  "string",
  "sys",
  "bun_alloc",
  "threading",
  "io",
  "http_jsc",
  "event_loop",
  "collections",
  "sql",
  "ptr",
  "boringssl",
  "spawn",
  "logger",
  "resolver",
  "watcher",
  "glob",
  "interchange",
  "shell_parser",
  "url",
  "sourcemap",
  "js_printer",
  "uws",
  "dns",
  "crash_handler",
  "css_jsc",
  "exe_format",
  "bunfig",
  "patch",
  "transpiler",
  "valkey",
  "zstd",
  "brotli",
];
// runtime is 270 files — split it into subdirs.
const RUNTIME_SUBDIRS = [
  "runtime/webcore",
  "runtime/node",
  "runtime/api",
  "runtime/server",
  "runtime/cli",
  "runtime/bake",
  "runtime/socket",
  "runtime/shell",
  "runtime/test_runner",
  "runtime/timer",
  "runtime/crypto",
  "runtime/ffi",
  "runtime/dns_jsc",
  "runtime/valkey_jsc",
  "runtime/image",
  "runtime/napi",
  "runtime/webview",
];
const SHARDS = [...RUNTIME_SUBDIRS.map(s => [s]), ...CRATES.filter(c => c !== "runtime").map(c => [c])];

const PATTERNS = `
**Pattern buckets** (assign each unsafe block to ONE):
- **ffi-call**: \`unsafe { extern_fn(...) }\` — wraps a single C/C++ FFI call
- **field-deref**: \`unsafe { &*self.ptr_field }\` / \`(*self.ptr).field\` — raw deref of a stored back-pointer
- **field-deref-mut**: \`unsafe { &mut *self.ptr }\` — mutable variant (aliasing risk)
- **slice-raw**: \`unsafe { slice::from_raw_parts(...) }\` / \`from_raw_parts_mut\`
- **vec-uninit**: \`unsafe { vec.set_len(...) }\` / spare-capacity write patterns
- **transmute**: \`unsafe { mem::transmute(...) }\` (or zerocopy)
- **lifetime-detach**: \`unsafe { detach_lifetime(...) }\` / \`&*(x as *const _)\` for 'static erasure
- **box-raw**: \`unsafe { Box::from_raw / heap::take / into_raw }\` ownership transfer
- **container-of**: \`unsafe { from_field_ptr! / container_of }\` intrusive backref
- **cstr**: \`unsafe { CStr::from_ptr / ZStr::from_raw }\`
- **uninit-read**: \`unsafe { MaybeUninit::assume_init / mem::zeroed }\`
- **atomic-ptr**: AtomicPtr load/store + deref
- **place-project**: \`unsafe { addr_of_mut!((*p).field) }\` raw place projection
- **send-sync**: \`unsafe impl Send/Sync\`
- **other**: doesn't fit above
`;

const CLASSIFY_S = {
  type: "object",
  properties: {
    shard: { type: "array", items: { type: "string" } },
    sites: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string" },
          line: { type: "number" },
          pattern: { type: "string" },
          context: { type: "string" },
          removable: { type: "boolean" },
          removable_how: { type: "string" },
        },
        required: ["file", "line", "pattern"],
      },
    },
    by_pattern: { type: "object" },
  },
  required: ["shard", "sites", "by_pattern"],
};
const STRATEGY_S = {
  type: "object",
  properties: {
    strategies: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          pattern: { type: "string" },
          title: { type: "string" },
          recipe: { type: "string" },
          abstraction: { type: "string" },
          site_count: { type: "number" },
          example_sites: { type: "array", items: { type: "string" } },
          unsafe_removed_est: { type: "number" },
          effort: { type: "string" },
          risk: { type: "string" },
          existing_tool: { type: "string" },
        },
        required: ["id", "pattern", "title", "recipe", "site_count", "effort"],
      },
    },
  },
  required: ["strategies"],
};
const APPLY_S = {
  type: "object",
  properties: {
    id: { type: "string" },
    applied: { type: "boolean" },
    sites_converted: { type: "number" },
    files_edited: { type: "array", items: { type: "string" } },
    abstraction_added: { type: "string" },
    notes: { type: "string" },
    skip_reason: { type: "string" },
  },
  required: ["id", "applied"],
};
const REVIEW_S = {
  type: "object",
  properties: {
    id: { type: "string" },
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
        required: ["what", "why_wrong", "severity"],
      },
    },
  },
  required: ["id", "accept", "bugs"],
};
const COMPILE_S = {
  type: "object",
  properties: {
    rounds: { type: "number" },
    errors_before: { type: "number" },
    errors_after: { type: "number" },
    unsafe_before: { type: "number" },
    unsafe_after: { type: "number" },
    commit: { type: "string" },
    notes: { type: "string" },
  },
  required: ["errors_after", "unsafe_after"],
};

const NO_TOOLS = `**HARD RULES (this phase):** Work in ${WT}. **DO NOT** run \`cargo\`/\`git\`/\`bun\`. NO commits. Read/Grep/Glob OK.`;

// ─── Phase 1: Classify ───────────────────────────────────────────────────────
phase("Classify");
log(`classify: ${SHARDS.length} shards`);
const classified = await parallel(
  SHARDS.map(
    (sh, idx) => () =>
      agent(
        `Classify EVERY \`unsafe {\` block in **src/${sh[0]}/**. Repo ${WT}.

${PATTERNS}

**Process:**
1. \`grep -rn 'unsafe {' ${WT}/src/${sh[0]}/ --include='*.rs'\` — list all sites.
2. For each site, read 10 lines context. Assign ONE pattern bucket.
3. **removable** = could a safe abstraction eliminate this unsafe at the CALL SITE? (The abstraction itself may have one unsafe inside — that's the win: N call-site unsafes → 1 in the abstraction.)
4. **removable_how** = 1-line: which abstraction? (e.g. "BackRef<T> field", "safe fn extern", "Vec::extend_from_slice instead of set_len+copy", "existing accessor method X", "make T: Sync")

For ffi-call: removable=true ONLY if all args are by-value/opaque-ZST/\`&T\` (eligible for \`safe fn\` extern decl).
For field-deref: removable=true if pointer is a never-null parent backref (BackRef) or has a safe accessor.
For send-sync/container-of/box-raw: usually removable=false (intrinsically unsafe).

${NO_TOOLS}

Return {shard:${JSON.stringify(sh)}, sites:[{file,line,pattern,context,removable,removable_how}], by_pattern:{<pattern>:count}}. Be EXHAUSTIVE.`,
        { label: `cls:${sh[0]}`, phase: "Classify", schema: CLASSIFY_S },
      ),
  ),
);
const allSites = classified.filter(Boolean).flatMap(c => c.sites || []);
const removable = allSites.filter(s => s.removable);
log(`classify: ${allSites.length} sites, ${removable.length} removable`);

// ─── Phase 2: Coalesce into strategies ───────────────────────────────────────
phase("Coalesce");
const byPattern = {};
for (const s of removable) {
  const k = `${s.pattern}::${(s.removable_how || "").slice(0, 60)}`;
  if (!byPattern[k]) byPattern[k] = [];
  byPattern[k].push(`${s.file}:${s.line}`);
}
const patternSummary = Object.entries(byPattern)
  .map(([k, v]) => ({ key: k, count: v.length, ex: v.slice(0, 3) }))
  .sort((a, b) => b.count - a.count);

const coalesce = await agent(
  `Coalesce ${removable.length} removable-unsafe sites into STRATEGIES (1 abstraction per pattern). Repo ${WT}.

**Removable sites by (pattern, removable_how)** — top 100:
${JSON.stringify(patternSummary.slice(0, 100), null, 0).slice(0, 50000)}

**Existing abstractions in-tree** (USE THESE before inventing new):
- \`bun_ptr::BackRef<T>\` — non-owning never-null parent ref, Deref + Copy
- \`bun_ptr::RawSlice<T>\` — borrowed slice, no lifetime param
- \`bun_jsc::cpp::*\` — generated safe wrappers for ZIG_EXPORT C++ fns
- \`top_scope!\`/\`validation_scope!\` — exception scope RAII
- \`MultiArrayList::split_mut()\` — disjoint column borrows
- \`safe fn\` in \`extern "C"\` blocks — when all args are value/opaque/out-param
- \`bun_ptr::RefPtr<T>\` / \`#[derive(CellRefCounted)]\` — intrusive refcount
- \`Vec::spare_capacity_mut()\` + \`MaybeUninit::write\` — instead of set_len patterns
- \`from_field_ptr!\` — already a macro, can't reduce further

**For each strategy, output:**
- id (S###), pattern bucket, title, recipe (3-5 sentences: what abstraction, where it lives, how callers convert)
- abstraction: NEW type/macro/fn to add (or "use existing: <name>")
- site_count, example_sites (5-10), unsafe_removed_est, effort (S/M/L), risk
- existing_tool: name of in-tree abstraction this is an ADOPTION SWEEP for (or "" if genuinely new)

**Prioritize**: high site_count × low risk × low effort. Target ~15-30 strategies. SKIP patterns where an abstraction would be UNSOUND (e.g. \`&mut\` accessor on re-entrant callback target — see PORT_NOTES_PLAN reviewer-rejections).

${NO_TOOLS}

Return {strategies:[...]}.`,
  { label: "coalesce", phase: "Coalesce", schema: STRATEGY_S },
);
const strategies = (coalesce && coalesce.strategies) || [];
log(`coalesce: ${strategies.length} strategies`);
if (!strategies.length) return { error: "no strategies", sites: allSites.length };

// ─── Phase 3: Apply per strategy ─────────────────────────────────────────────
phase("Apply");
const applied = await parallel(
  strategies.map(
    s => () =>
      agent(
        `Apply strategy **${s.id}: ${s.title}** (${s.pattern}). Repo ${WT}.

**Recipe:** ${s.recipe}
**Abstraction:** ${s.abstraction || s.existing_tool}
**Sites (~${s.site_count}, examples):** ${(s.example_sites || []).join(", ")}
**Risk:** ${s.risk || ""}

**Process:**
1. If abstraction is NEW: add it to the appropriate crate (usually bun_core/bun_ptr/bun_collections/the *_sys crate). ONE unsafe inside, with full SAFETY doc.
2. Find ALL matching sites: \`grep -rn '<pattern-regex>' ${WT}/src/ --include='*.rs'\` (derive regex from the recipe).
3. Convert each site: replace the unsafe block with the safe call. Update imports.
4. **BE AGGRESSIVE** — r1 only converted 9% of removable sites because apply-agents were over-cautious without cargo. The compile-agent fixes errors; convert any site where the invariant *plausibly* holds. SKIP only if: ptr can be NULL (and abstraction requires non-null); buffer is mutated while borrow live (the ZStr::from_buf trap); FFI mutates struct via \`&self\`-derived ptr and fields aren't UnsafeCell (the WTFStringImpl trap).
5. If you discover the strategy is unsound (e.g. would create aliased \`&mut\`): set applied:false + skip_reason and edit NOTHING.

**Known r1 traps (DO NOT repeat):**
- Changing receiver \`*mut Self\`→\`&self\` when C++ FFI mutates struct fields → fields must be \`Cell<T>\`/\`UnsafeCell\` first.
- \`ZStr::from_buf(&buf, n)\` where \`buf\` is later mutated while the ZStr is live → keep \`from_raw\` with SAFETY comment.
- safe fn that only \`debug_assert!\`s a precondition release-UB-if-violated → use \`assert!\` or \`NonNull\` parameter.

${NO_TOOLS} (Edit OK, NO cargo/git)

Return {id:"${s.id}", applied, sites_converted:N, files_edited:[...], abstraction_added, notes, skip_reason}.`,
        { label: `apply:${s.id}`, phase: "Apply", schema: APPLY_S },
      ),
  ),
);
const did = (applied || []).filter(r => r && r.applied);
log(
  `apply: ${did.length}/${strategies.length} applied, ${did.reduce((n, d) => n + (d.sites_converted || 0), 0)} sites converted`,
);

// ─── Phase 4: Review (2-vote per strategy) ───────────────────────────────────
phase("Review");
const reviewed = await pipeline(did, d =>
  parallel(
    [0, 1].map(
      i => () =>
        agent(
          `Adversarially review strategy **${d.id}** application. Repo ${WT}.

Converted ${d.sites_converted} sites in ${(d.files_edited || []).length} files. Abstraction: ${d.abstraction_added || ""}.

**Read** the abstraction (if new) + 5-10 converted sites (sample from ${JSON.stringify((d.files_edited || []).slice(0, 8))}).

**Check:**
1. **Soundness**: does the abstraction's SAFETY contract hold at every converted site? (e.g. BackRef requires never-null + outlives — true at each site?)
2. **Aliasing**: any site where the new safe call creates aliased \`&mut\` (re-entrancy via callback)?
3. **Semantics**: behavior change vs original unsafe block?
4. **Laundering**: did this just MOVE unsafe into a "safe" wrapper that still has the same hazards? (e.g. \`pub fn x() -> &'static T\` that's actually unsound)

DEFAULT accept:true. DO NOT edit/run.

Return {id:"${d.id}", accept, bugs:[{file,what,why_wrong,fix,severity}]}.`,
          { label: `rev${i}:${d.id}`, phase: "Review", schema: REVIEW_S },
        ),
    ),
  ).then(votes => {
    const all = (votes || []).filter(Boolean).flatMap(v => v.bugs || []);
    const blocking = all.filter(b => ["ub", "leak", "semantics"].includes(b.severity));
    return { id: d.id, applied: d, blocking, all_bugs: all };
  }),
);

// ─── Phase 5: Compile + fix bugs + commit ────────────────────────────────────
phase("Compile");
const allBlocking = reviewed.filter(Boolean).flatMap(r => r.blocking);
const compile = await agent(
  `FINAL: fix reviewer bugs + compile + commit. Repo ${WT}. **You may use cargo/git.**

**${allBlocking.length} BLOCKING reviewer findings to fix first:**
${allBlocking
  .map((b, i) => `${i + 1}. [${b.severity}] ${b.file || ""}: ${b.what}\n   FIX: ${b.fix}`)
  .join("\n")
  .slice(0, 20000)}

**Process (loop ≤8 rounds):**
1. Apply ALL blocking fixes above.
2. \`cd ${WT} && cargo check --workspace --keep-going 2>&1 > /tmp/uw-check.log; grep -cE '^error\\[' /tmp/uw-check.log\`
3. If errors: fix per-file (stale use paths, missing re-exports). Read .zig spec.
4. **5-target clean-leaf** (r1 only checked Linux and shipped a macOS E0119): \`for t in x86_64-pc-windows-msvc aarch64-apple-darwin x86_64-unknown-freebsd aarch64-linux-android x86_64-unknown-linux-musl; do cargo clean -p bun_runtime -p bun_bin --target $t 2>/dev/null; cargo check -p bun_bin --target $t 2>&1 | grep -cE '^error\\['; done\` — fix any non-zero.
5. unsafe_after = \`grep -rn 'unsafe {' ${WT}/src/ --include='*.rs' | wc -l\`
6. \`cd ${WT} && bun bd --version\` exit 0 + \`bun bd test test/js/bun/util/inspect.test.js\` 72/0.
7. \`cd ${WT} && git -c core.hooksPath=/dev/null add -A 'src/' Cargo.toml Cargo.lock && git -c core.hooksPath=/dev/null commit -q -m "phase-h: unsafe-wrap r2 ${did.length} strategies (...)"\`. NO push.

Return {rounds, errors_before, errors_after, unsafe_before, unsafe_after, commit, notes}.`,
  { label: "compile-fix-commit", phase: "Compile", schema: COMPILE_S },
);

return {
  total_sites: allSites.length,
  removable: removable.length,
  strategies: strategies.length,
  applied: did.length,
  sites_converted: did.reduce((n, d) => n + (d.sites_converted || 0), 0),
  blocking_bugs: allBlocking.length,
  compile,
  strategies_detail: strategies.map(s => ({
    id: s.id,
    title: s.title,
    pattern: s.pattern,
    sites: s.site_count,
    effort: s.effort,
    existing: s.existing_tool,
  })),
  applied_detail: did.map(d => ({
    id: d.id,
    converted: d.sites_converted,
    files: (d.files_edited || []).length,
    notes: (d.notes || "").slice(0, 150),
  })),
};
