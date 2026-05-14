export const meta = {
  name: "phase-h-dedup",
  description:
    "Exhaustive codebase deduplication. Find (sharded) → cross-ref → 2-vote verify+propose → apply dedup → final compile+fix. ~50M tokens. Agents NO git/cargo until final.",
  phases: [
    { title: "Find", detail: "30 shard-agents read crates exhaustively, output dup candidates" },
    { title: "CrossRef", detail: "merge candidates across shards into clusters" },
    { title: "Verify", detail: "2-vote per cluster: real dup? propose canonical+approach" },
    { title: "Dedup", detail: "apply per accepted cluster (Edit only)" },
    { title: "Compile", detail: "ONE agent: cargo check + fix + commit (only step with git/cargo)" },
  ],
};

const A = typeof args === "string" ? JSON.parse(args) : args || {};
const WT = A.worktree || "/root/bun-5-dedup";
const CRATES = A.crates || [
  "analytics",
  "api",
  "base64",
  "boringssl",
  "boringssl_sys",
  "brotli",
  "brotli_sys",
  "bun_alloc",
  "bun_bin",
  "bun_core",
  "bun_core_macros",
  "bundler",
  "bundler_jsc",
  "bunfig",
  "cares_sys",
  "clap",
  "clap_macros",
  "codegen",
  "collections",
  "crash_handler",
  "csrf",
  "css",
  "css_derive",
  "css_jsc",
  "dispatch",
  "dns",
  "dotenv",
  "errno",
  "event_loop",
  "exe_format",
  "glob",
  "hash",
  "highway",
  "http",
  "http_jsc",
  "http_types",
  "ini",
  "install",
  "install_jsc",
  "install_types",
  "interchange",
  "io",
  "js_parser",
  "js_parser_jsc",
  "js_printer",
  "jsc",
  "jsc_macros",
  "libarchive",
  "libarchive_sys",
  "libdeflate_sys",
  "libuv_sys",
  "logger",
  "logger_jsc",
  "lolhtml_sys",
  "md",
  "meta",
  "mimalloc_sys",
  "options_types",
  "output",
  "patch",
  "patch_jsc",
  "paths",
  "perf",
  "picohttp",
  "picohttp_sys",
  "platform",
  "ptr",
  "resolve_builtins",
  "resolver",
  "router",
  "runtime",
  "s3_signing",
  "safety",
  "semver",
  "semver_jsc",
  "sha_hmac",
  "shell_parser",
  "simdutf_sys",
  "sourcemap",
  "sourcemap_jsc",
  "spawn",
  "spawn_sys",
  "sql",
  "sql_jsc",
  "standalone_graph",
  "string",
  "sys",
  "sys_jsc",
  "tcc_sys",
  "threading",
  "transpiler",
  "unicode",
  "url",
  "url_jsc",
  "uws",
  "uws_sys",
  "valkey",
  "watcher",
  "which",
  "windows_sys",
  "wyhash",
  "zlib",
  "zlib_sys",
  "zstd",
];
// Shard crates into ~30 groups for the Find phase.
const SHARD_SIZE = Math.ceil(CRATES.length / 30);
const SHARDS = [];
for (let i = 0; i < CRATES.length; i += SHARD_SIZE) SHARDS.push(CRATES.slice(i, i + SHARD_SIZE));

const FIND_S = {
  type: "object",
  properties: {
    shard: { type: "array", items: { type: "string" } },
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["struct", "enum", "fn", "trait", "macro", "extern_decl", "type_alias", "const", "helper_pattern"],
          },
          name: { type: "string" },
          locations: { type: "array", items: { type: "string" } },
          signature: { type: "string" },
          body_hash: { type: "string" },
          why_duplicate: { type: "string" },
          cross_crate: { type: "boolean" },
        },
        required: ["kind", "name", "locations", "why_duplicate"],
      },
    },
  },
  required: ["shard", "candidates"],
};
const CLUSTER_S = {
  type: "object",
  properties: {
    clusters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          kind: { type: "string" },
          name: { type: "string" },
          locations: { type: "array", items: { type: "string" } },
          why: { type: "string" },
        },
        required: ["id", "kind", "name", "locations"],
      },
    },
  },
  required: ["clusters"],
};
const VERIFY_S = {
  type: "object",
  properties: {
    id: { type: "string" },
    is_duplicate: { type: "boolean" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    canonical: { type: "string" },
    approach: { type: "string" },
    risk: { type: "string" },
    skip_reason: { type: "string" },
  },
  required: ["id", "is_duplicate", "confidence"],
};
const DEDUP_S = {
  type: "object",
  properties: {
    id: { type: "string" },
    applied: { type: "boolean" },
    files_edited: { type: "array", items: { type: "string" } },
    callers_routed: { type: "number" },
    notes: { type: "string" },
    skip_reason: { type: "string" },
  },
  required: ["id", "applied"],
};
const COMPILE_S = {
  type: "object",
  properties: {
    rounds: { type: "number" },
    errors_before: { type: "number" },
    errors_after: { type: "number" },
    commit: { type: "string" },
    notes: { type: "string" },
  },
  required: ["errors_after"],
};

const NO_TOOLS = `**HARD RULES (this phase):** Work in ${WT}. **DO NOT** run \`cargo\`/\`git\`/\`bun\`. Edit via Edit tool only. NO commits. NO build/exec.`;

// ─── Phase 1: Find ───────────────────────────────────────────────────────────
phase("Find");
log(`find: ${SHARDS.length} shards across ${CRATES.length} crates`);
const found = await parallel(
  SHARDS.map(
    (sh, idx) => () =>
      agent(
        `Exhaustively find DUPLICATE definitions in **src/{${sh.join(",")}}/**. Repo ${WT}. READ ONLY.

**What counts as a duplicate** (≥2 locations, semantically equivalent or near-equivalent):
1. **struct/enum**: same fields (modulo order/cfg), same purpose. Names may differ.
2. **fn**: same body (modulo trivial rename), or same algorithm reimplemented. Free fn duplicated as method or vice versa.
3. **trait**: same method set, different name.
4. **extern_decl**: same C symbol declared in multiple crates (\`extern "C" { fn X }\`).
5. **macro**: same expansion, copy-pasted across crates.
6. **type_alias/const**: same RHS.
7. **helper_pattern**: a 5-20 line code pattern repeated in ≥3 places (e.g. "convert ZigString→&[u8] with NUL handling", "wrap Maybe<T> error", "intern path string").

**Process:**
- For each crate in your shard, read \`src/<crate>/lib.rs\` + every \`*.rs\` in it (use Glob+Read).
- Build a mental index of {struct names + fields, fn names + sigs, extern symbols, macro names, recurring code snippets}.
- ALSO grep cross-crate: \`grep -rn '^pub struct <Name>\\b\\|^pub fn <name>\\b' ${WT}/src/ --include='*.rs'\` for each item to find duplicates OUTSIDE your shard.
- For each dup, record ALL locations (file:line), a 1-line signature, and WHY it's a duplicate (not just "same name" — same NAME different SEMANTICS is NOT a dup).

**Skip**: generic names with intentionally different semantics (e.g. 23× \`Options\` structs are per-API config — only flag if FIELDS overlap ≥80%). Test fixtures. Generated files in build/.

**r1 already handled (skip these — already deduped or correctly rejected)**: PathName(→bun_paths), WTFStringImpl methods, opaque_ffi! macros, resolver::fs::Path, c_chars_as_bytes, GetSystemInfo, mimalloc free/resize variants (intentional backend split), Mutex tier-0, BSSAppendable array-vs-slice, brotli_mut accessor, uv_disable_stdio_inheritance, is_identifier_start/continue, hostent callback_wrapper, CountingWriter/DiscardingWriter, winsock sockaddr structs.

**Focus r2 on what r1 missed**: helper_pattern (5-20 line code blocks repeated ≥3×), trait impls, error-conversion boilerplate, FFI thunk shapes, format_args! constructions.

${NO_TOOLS} (Read/Grep/Glob OK; no Edit this phase)

Return {shard:${JSON.stringify(sh)}, candidates:[{kind,name,locations:[file:line,...],signature,why_duplicate,cross_crate}]}. Be EXHAUSTIVE — better to over-report than miss.`,
        { label: `find:${idx}:${sh[0]}+${sh.length - 1}`, phase: "Find", schema: FIND_S },
      ),
  ),
);
const allCand = found.filter(Boolean).flatMap(f => f.candidates || []);
log(`find: ${allCand.length} raw candidates`);

// ─── Phase 2: Cross-reference into clusters ──────────────────────────────────
phase("CrossRef");
const crossref = await agent(
  `Cross-reference ${allCand.length} duplicate candidates into CLUSTERS. Repo ${WT}.

**Input candidates** (kind,name,locations,why):
${JSON.stringify(
  allCand.map(c => ({ k: c.kind, n: c.name, l: c.locations, w: (c.why_duplicate || "").slice(0, 100) })),
  null,
  0,
).slice(0, 80000)}

**Process:**
1. **Dedup the candidate list**: many shards report the same dup. Merge by (kind, normalized-name, location-set overlap).
2. **Cluster**: group candidates that are the SAME duplicate (e.g. 3 reports of "fn relative_path duplicated in {A,B,C}" → 1 cluster).
3. **Filter noise**: drop clusters where locations.length < 2; drop generic-name false positives (Options/Flags/Entry/State with <80% field overlap — re-read the files if unsure).
4. Assign each cluster a stable id "D###".

${NO_TOOLS} (Read OK to disambiguate)

Return {clusters:[{id,kind,name,locations,why}]}. Target: ~50-200 high-confidence clusters.`,
  { label: "crossref", phase: "CrossRef", schema: CLUSTER_S },
);
const clusters = (crossref && crossref.clusters) || [];
log(`crossref: ${clusters.length} clusters`);
if (!clusters.length) return { error: "no clusters", raw_candidates: allCand.length };

// ─── Phase 3: Verify (2-vote) + propose approach ─────────────────────────────
phase("Verify");
const verified = await pipeline(clusters, c =>
  parallel(
    [0, 1].map(
      i => () =>
        agent(
          `Verify duplicate cluster **${c.id}** (${c.kind} \`${c.name}\`). Repo ${WT}.

**Locations:** ${c.locations.join(", ")}
**Why flagged:** ${c.why || ""}

**Read EACH location** + 20 lines context. **Decide:**
1. **is_duplicate**: are these SEMANTICALLY equivalent? (Same fields/body/contract — not just same name. Read .zig spec at each location if it exists.)
2. **confidence**: high (byte-identical or trivially-renamed)/medium (same algorithm, minor divergence)/low (similar but legitimately different).
3. **canonical**: which location should be THE one? (Usually: lowest-tier crate per dep graph, or the one with the most callers, or the one matching .zig spec.)
4. **approach**: HOW to dedup. e.g. "delete B,C; \`pub use canonical::X\` re-export in B,C's lib.rs; update 12 callers' \`use\` paths" or "extract to bun_core::helpers; route all 3" or "make B's a type alias to A's" or "DON'T — these diverged intentionally (cite the comment/spec line)".
5. **risk**: what could break? Perf-sensitive? cfg-gated divergence?

If NOT a real dup or risk>benefit: is_duplicate=false + skip_reason.

${NO_TOOLS}

Return {id:"${c.id}", is_duplicate, confidence, canonical, approach, risk, skip_reason}.`,
          { label: `ver${i}:${c.id}`, phase: "Verify", schema: VERIFY_S },
        ),
    ),
  ).then(votes => {
    const v = (votes || []).filter(Boolean);
    const both_dup = v.length >= 2 && v.every(x => x.is_duplicate);
    const both_high = v.every(x => x.confidence === "high" || x.confidence === "medium");
    // Pick the more detailed approach
    const best = v.sort((a, b) => (b.approach || "").length - (a.approach || "").length)[0] || {};
    return { cluster: c, accepted: both_dup && both_high, votes: v, plan: best };
  }),
);
const accepted = verified.filter(r => r && r.accepted);
log(`verify: ${accepted.length}/${clusters.length} accepted (2-vote, ≥medium confidence)`);

// ─── Phase 4: Dedup (Edit only) ──────────────────────────────────────────────
phase("Dedup");
const applied = await parallel(
  accepted.map(
    r => () =>
      agent(
        `Apply deduplication for **${r.cluster.id}** (${r.cluster.kind} \`${r.cluster.name}\`). Repo ${WT}.

**Locations:** ${r.cluster.locations.join(", ")}
**Canonical:** ${r.plan.canonical || "(choose lowest-tier)"}
**Approach:** ${r.plan.approach || ""}
**Risk:** ${r.plan.risk || ""}

**Process:**
1. Read all locations + canonical. Confirm the approach is correct (if 2 verifiers disagreed on canonical, pick the lower-tier crate).
2. **Delete duplicates** (or make them \`pub use canonical::X;\` / \`pub type X = canonical::X;\` re-exports if external callers depend on the path).
3. **Route callers**: \`grep -rn 'use.*::${r.cluster.name}\\b\\|${r.cluster.name}::' ${WT}/src/\` — update each \`use\` to the canonical path.
4. If the dups had MINOR divergences, merge them into the canonical (union of cfg branches, etc.).
5. If you discover it's NOT actually safe to dedup (verifier missed something), set applied:false + skip_reason and edit NOTHING.

${NO_TOOLS} (Edit OK, NO cargo/git)

Return {id:"${r.cluster.id}", applied, files_edited:[...], callers_routed:N, notes, skip_reason}.`,
        { label: `dedup:${r.cluster.id}`, phase: "Dedup", schema: DEDUP_S },
      ),
  ),
);
const did = (applied || []).filter(r => r && r.applied);
log(`dedup: ${did.length}/${accepted.length} applied`);

// ─── Phase 5: Compile + fix + commit (ONLY agent allowed cargo/git) ──────────
phase("Compile");
const compile = await agent(
  `FINAL: compile-fix-commit the dedup. Repo ${WT}. **You are the ONLY agent allowed cargo/git.**

${did.length} deduplications applied. Files edited: ${JSON.stringify([...new Set(did.flatMap(d => d.files_edited || []))].slice(0, 100))}

**Process (loop until 0 errors, max 8 rounds):**
1. \`cd ${WT} && cargo check --workspace --keep-going 2>&1 > /tmp/dedup-check.log; grep -cE '^error\\[' /tmp/dedup-check.log\`
2. If errors: per-file errfiles via \`grep -oP '\\-\\-> \\Ksrc/[^:]+\\.rs' /tmp/dedup-check.log | sort | uniq -c\`. Fix each (usually: stale \`use\` path, missing re-export, cfg mismatch). Read .zig spec.
3. Loop until 0.
4. **5-target clean-leaf** (r1 missed cross-target breaks): \`for t in x86_64-pc-windows-msvc aarch64-apple-darwin x86_64-unknown-freebsd aarch64-linux-android x86_64-unknown-linux-musl; do cargo clean -p bun_runtime -p bun_bin --target $t 2>/dev/null; cargo check -p bun_bin --target $t 2>&1 | grep -cE '^error\\['; done\` — fix any non-zero.
5. **Soundness check** (r1 introduced \`&self\` SB-UB): if any dedup changed a method receiver from raw-ptr to \`&self\`/\`&mut self\` AND that method calls FFI that mutates the struct → ensure the mutated fields are \`Cell<T>\`/\`UnsafeCell\`, or revert that receiver change.
6. \`cd ${WT} && bun bd --version\` exit 0 + \`bun bd test test/js/bun/util/inspect.test.js\` 72/0.
7. \`cd ${WT} && git -c core.hooksPath=/dev/null add -A 'src/' Cargo.toml Cargo.lock && git -c core.hooksPath=/dev/null commit -q -m "phase-h: dedup r2 ${did.length} clusters"\`. NO push.

Return {rounds, errors_before, errors_after, commit, notes}.`,
  { label: "compile-fix-commit", phase: "Compile", schema: COMPILE_S },
);

return {
  raw_candidates: allCand.length,
  clusters: clusters.length,
  accepted: accepted.length,
  applied: did.length,
  compile,
  rejected: verified
    .filter(r => r && !r.accepted)
    .map(r => ({ id: r.cluster.id, name: r.cluster.name, reason: (r.votes[0] || {}).skip_reason || "vote split" }))
    .slice(0, 50),
  applied_detail: did.map(d => ({
    id: d.id,
    files: (d.files_edited || []).length,
    callers: d.callers_routed,
    notes: (d.notes || "").slice(0, 150),
  })),
};
