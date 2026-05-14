export const meta = {
  name: "porting-md-zigleakage",
  description: "Adversarial sweep of PORTING.md for Zig idioms that Rust makes unnecessary",
  phases: [
    { title: "Audit", detail: "8 dimension auditors find Zig-leakage in PORTING.md" },
    { title: "Verify", detail: "3-vote adversarial refute per finding" },
    { title: "Synthesize", detail: "dedup + produce PORTING.md patch" },
  ],
};

const REPO = "/root/bun-5";
const GUIDE = `${REPO}/docs/PORTING.md`;

const DIMENSIONS = [
  {
    key: "allocator-threading",
    prompt: `PORTING.md §Allocators says \`std.mem.Allocator\` param → \`&dyn bun_alloc::Allocator\`. This is Zig idiom: Zig has no global allocator so every fn threads one. Rust has \`#[global_allocator]\` (set to mimalloc per §Ground rules). Audit: for which Zig allocator-passing patterns should the Rust port DROP the param entirely vs KEEP it? Consider: arena (\`MimallocArena\`, \`ArenaAllocator\`, \`StackFallbackAllocator\`), per-request bundler arenas, FFI hand-off, stored-on-struct-for-later. Produce concrete rule rewrites.`,
  },
  {
    key: "collections",
    prompt: `PORTING.md §Collections maps \`std.ArrayList(T)\` → \`bun_collections::List<T>\` (custom 1.5× growth + push_assume_capacity). Audit: is this justified or is plain \`Vec<T>\` correct? For each \`bun_collections::*\` mapping, determine if a std type is behaviorally equivalent. Real constraints to respect: \`BabyList\` is \`#[repr(C)]\` and crosses FFI; \`MultiArrayList\` is SoA with no std equiv; hash maps must be wyhash (not SipHash) for determinism. Everything else: does it need a custom type?`,
  },
  {
    key: "manual-lifetime",
    prompt: `PORTING.md tells agents to keep explicit \`deinit()\` methods, use \`ManuallyDrop\`, hand-roll \`IntrusiveRc\`, write Drop guards for \`errdefer\`. Audit: which of these are necessary (FFI, intrusive lists, arena-reset) vs Zig habit that Rust's ownership/Drop obviates? E.g. \`fn deinit(&mut self)\` when Drop would suffice; \`deep_clone(&self, alloc)\` when \`impl Clone\` works.`,
  },
  {
    key: "error-model",
    prompt: `PORTING.md maps \`anyerror!T\` → \`Result<T, bun_core::Error>\` (single global error enum). Zig's \`anyerror\` is a global union because Zig lacks trait objects. Audit: is a single \`bun_core::Error\` the right Rust model, or should it be \`anyhow::Error\`/per-crate \`thiserror\` enums/something else? Consider: error_name() ABI compat, FFI, no_std constraints.`,
  },
  {
    key: "pointer-idiom",
    prompt: `PORTING.md §Pointers/§Type map: \`?*T\` field → \`Option<NonNull<T>>\`, \`*T\` → raw ptr if aliased, \`container_of!\` for intrusive. Audit: which raw-pointer mappings are necessary (FFI, intrusive, self-referential) vs Zig habit where Rust would use \`Box\`/\`Rc\`/\`&\`/index-into-arena? Flag any rule that defaults to raw ptr when a safe type works.`,
  },
  {
    key: "comptime-carryover",
    prompt: `PORTING.md §Comptime: \`comptime\` → \`const fn\`/\`macro_rules!\`/const generics. Audit: which Zig comptime patterns exist ONLY because Zig lacks traits/generics, and in Rust become plain generic fns or trait impls (no macro needed)? E.g. \`anytype\` writer params, \`inline for\` over homogeneous tuples.`,
  },
  {
    key: "api-shape",
    prompt: `Audit PORTING.md for Zig API-shape leakage: out-params (\`buf: &mut [u8], written: &mut usize\`) where Rust would return owned; \`PathBuffer\` thread-local pools where \`PathBuf\`/stack array works; \`init()/deinit()\` pairs where \`new() + Drop\` works; format-into-writer where \`Display\` works. For each pattern in the doc, propose the idiomatic Rust shape.`,
  },
  {
    key: "trial-port-diff",
    prompt: `Do a trial port of these 3 files per CURRENT PORTING.md rules, then rewrite each as a Rust-native engineer would (ignoring PORTING.md), and diff:
  - ${REPO}/src/css/rules/custom_media.zig (allocator-heavy small struct)
  - ${REPO}/src/sql/postgres/protocol/ErrorResponse.zig (ArrayList + error handling)
  - ${REPO}/src/http/CertificateInfo.zig (deinit + slices)
For every divergence between the PORTING.md-port and the idiomatic-port, emit a finding: which PORTING.md rule caused it, and what the rule should say instead. DO NOT write .rs files to disk — work in your response only.`,
  },
];

const FINDINGS = {
  type: "object",
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["section", "current_rule", "problem", "proposed_rule"],
        properties: {
          section: { type: "string", description: "PORTING.md section heading or table row" },
          current_rule: { type: "string", description: "exact text or paraphrase of what PORTING.md says now" },
          problem: { type: "string", description: "why this is Zig-leakage / wrong for Rust" },
          proposed_rule: { type: "string", description: "exact replacement text for PORTING.md" },
          constraint_check: {
            type: "string",
            description: 'FFI/ABI/arena/perf constraint that might justify keeping the current rule (or "none")',
          },
        },
      },
    },
  },
};

const VERDICT = {
  type: "object",
  required: ["refuted", "reason"],
  properties: {
    refuted: {
      type: "boolean",
      description:
        "true = finding is WRONG (current PORTING.md rule is correct / proposed change would break something)",
    },
    reason: { type: "string" },
  },
};

// Seed with the two user-flagged issues so they definitely survive
const SEED = [
  {
    section: "Ground rules",
    current_rule: "(no perf-marker convention exists)",
    problem:
      "Dropping Zig perf idioms (assume-capacity, arena, pooled buffers) for idiomatic Rust may regress hot paths. Need a convention so Phase B can find and profile them.",
    proposed_rule:
      "Add to Ground rules: **Perf markers.** When the Zig used a perf-specific idiom (`appendAssumeCapacity`, `ensureTotalCapacityPrecise`, arena allocator, pooled buffer, `inline for`) and the Rust port uses the plain idiomatic form, leave `// PERF(port): <zig idiom> — profile in Phase B` on that line. Phase A optimizes for correctness+idiom; Phase B greps `PERF(port)` and benchmarks.",
    constraint_check: "none — this is additive",
    _dim: "seed",
  },
  {
    section: "Allocators",
    current_rule: "`std.mem.Allocator` param → always `&dyn bun_alloc::Allocator` in Phase A",
    problem:
      "Zig threads allocators because it has no global allocator. Rust does (mimalloc via #[global_allocator]). 95% of these params are dead weight.",
    proposed_rule:
      "DROP the allocator param unless the call site passes a non-default allocator (MimallocArena / std.heap.ArenaAllocator / StackFallbackAllocator / LinearFifo). If the body only does alloc.create/alloc/dupe/free or threads to ArrayList.append → delete the param; Vec/Box/String use global mimalloc. KEEP only for: arena-backed (parser Store, bundler chunk arenas), stored on struct for later arena use, or FFI.",
    constraint_check: "arena allocators are real and must stay; everything else: none",
    _dim: "seed",
  },
  {
    section: "Collections",
    current_rule: "`std.ArrayList(T)` → `bun_collections::List<T>` (1.5× growth, push_assume_capacity)",
    problem: "Vec<T> already uses mimalloc and has equivalent perf. Custom List is Zig-ArrayList cosplay.",
    proposed_rule:
      "`std.ArrayList(T)` / `std.ArrayListUnmanaged(T)` → `Vec<T>`. Drop the per-call alloc arg. `.appendAssumeCapacity(x)` → `v.push(x)` in Phase A (Phase B can swap to `push_within_capacity` after profiling). Only keep `bun_collections::*` for: `BabyList` (#[repr(C)], crosses FFI), `MultiArrayList` (SoA, no std equiv), `HashMap`/`StringHashMap` (wyhash determinism), `ArrayHashMap` (insertion-order + contiguous .values()).",
    constraint_check: "BabyList ABI, MultiArrayList SoA, wyhash determinism — those stay custom",
    _dim: "seed",
  },
];

phase("Audit");
const audits = await parallel(
  DIMENSIONS.map(
    d => () =>
      agent(
        `Read ${GUIDE} fully. You may grep ${REPO}/src/**/*.zig for usage frequency. ${d.prompt}\n\nReturn ONLY findings where PORTING.md's current rule produces non-idiomatic Rust. Each finding must cite the exact section and propose replacement text. If a rule looks like Zig-leakage but a real constraint (FFI ABI, arena lifetime, GC stack-scan, determinism) justifies it, note that in constraint_check and STILL include it — verifiers will judge.\n\nReturn AT MOST 12 findings — the highest-impact ones (prioritize by how many .zig files the pattern appears in).`,
        { label: `audit:${d.key}`, phase: "Audit", schema: FINDINGS },
      ).then(r => (r ? r.findings.map(f => ({ ...f, _dim: d.key })) : [])),
  ),
);
const all = [...SEED, ...audits.flat()];
log(`audit: ${all.length} raw findings (incl. 2 seed)`);

phase("Verify");
const verified = await parallel(
  all.map((f, i) => async () => {
    const votes = await parallel(
      Array.from(
        { length: 3 },
        (_, j) => () =>
          agent(
            `You are refuting a proposed PORTING.md change. Default to refuted=true unless the change is clearly correct.\n\nRead ${GUIDE} (the current doc). You may grep ${REPO}/src for real usage.\n\nFinding (from dimension "${f._dim}"):\n  Section: ${f.section}\n  Current rule: ${f.current_rule}\n  Problem claimed: ${f.problem}\n  Proposed: ${f.proposed_rule}\n  Constraint noted: ${f.constraint_check || "none"}\n\nRefute if ANY of: (a) the current rule is actually correct for a real constraint (FFI ABI, arena, GC, determinism, perf), (b) the proposed rule would break Phase-B compilation or introduce UB, (c) the "problem" misunderstands Rust or Zig. Otherwise refuted=false.`,
            { label: `verify:${i}.${j}`, phase: "Verify", schema: VERDICT },
          ),
      ),
    );
    const refutes = votes.filter(v => v && v.refuted).length;
    return { ...f, refutes, survives: refutes < 2, reasons: votes.map(v => v && v.reason) };
  }),
);
const confirmed = verified.filter(f => f.survives);
log(`verify: ${confirmed.length}/${all.length} survive 3-vote refute`);

phase("Synthesize");
const patch = await agent(
  `Read ${GUIDE}. Below are ${confirmed.length} adversarially-confirmed Zig-leakage findings. Produce a unified PORTING.md patch:\n\n1. Group findings by section.\n2. For each section, write the EXACT new text (not a diff) that replaces the current rule(s).\n3. Where findings overlap/conflict, merge into one coherent rule.\n4. Preserve every real constraint noted (FFI/arena/GC/wyhash).\n5. **Perf caveat rule:** wherever a Zig perf idiom is being replaced with plain idiomatic Rust, the new rule MUST instruct agents to leave \`// PERF(port): <what> — profile in Phase B\`. Do not silently drop perf intent.\n6. Output as: { sections: [{heading, old_snippet, new_text, rationale}] }.\n\nFindings:\n${JSON.stringify(
    confirmed.map(({ _dim, section, current_rule, problem, proposed_rule, constraint_check }) => ({
      dim: _dim,
      section,
      current_rule,
      problem,
      proposed_rule,
      constraint_check,
    })),
    null,
    2,
  )}`,
  {
    label: "synthesize",
    phase: "Synthesize",
    schema: {
      type: "object",
      required: ["sections"],
      properties: {
        sections: {
          type: "array",
          items: {
            type: "object",
            required: ["heading", "old_snippet", "new_text", "rationale"],
            properties: {
              heading: { type: "string" },
              old_snippet: {
                type: "string",
                description: "first ~80 chars of the text being replaced, for Edit anchoring",
              },
              new_text: { type: "string" },
              rationale: { type: "string" },
            },
          },
        },
      },
    },
  },
);

return {
  raw_findings: all.length,
  confirmed: confirmed.length,
  by_dimension: Object.fromEntries(
    [...new Set(all.map(f => f._dim))].map(d => [
      d,
      { found: all.filter(f => f._dim === d).length, survived: confirmed.filter(f => f._dim === d).length },
    ]),
  ),
  refuted: verified
    .filter(f => !f.survives)
    .map(f => ({ section: f.section, dim: f._dim, why: f.reasons.filter(Boolean)[0] })),
  patch,
  confirmed_detail: confirmed,
};
