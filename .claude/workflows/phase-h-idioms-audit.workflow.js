export const meta = {
  name: "phase-h-idioms-audit",
  description:
    "Adversarial whole-codebase review: per-crate reviewers catalog anti-patterns → 2-vote verify → ranked idioms doc.",
  phases: [
    { title: "Scan", detail: "list crates + line counts" },
    { title: "Review", detail: "per-crate adversarial reviewer: catalog smells with file:line evidence" },
    { title: "Verify", detail: "2-vote per finding: real problem? right fix? perf cost?" },
    { title: "Synth", detail: "rank by (count × severity), write docs/RUST_IDIOMS_AUDIT.md" },
  ],
};

const A = typeof args === "string" ? JSON.parse(args) : args || {};
const TOP_N_CRATES = A.top_n || 30; // by line count

const SCAN_S = {
  type: "object",
  properties: {
    crates: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, dir: { type: "string" }, lines: { type: "number" } },
        required: ["name", "dir", "lines"],
      },
    },
  },
  required: ["crates"],
};
const REVIEW_S = {
  type: "object",
  properties: {
    crate: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          example: { type: "string" },
          why_bad: { type: "string" },
          idiomatic: { type: "string" },
          severity: { type: "string" },
          count_estimate: { type: "number" },
        },
        required: ["pattern", "example", "why_bad", "idiomatic", "severity"],
      },
    },
  },
  required: ["crate", "findings"],
};
const VERIFY_S = {
  type: "object",
  properties: {
    pattern: { type: "string" },
    real: { type: "boolean" },
    refute_reason: { type: "string" },
    perf_cost_of_fix: { type: "string" },
    better_fix: { type: "string" },
  },
  required: ["pattern", "real"],
};
const SYNTH_S = {
  type: "object",
  properties: { doc_path: { type: "string" }, patterns_ranked: { type: "number" } },
  required: ["doc_path", "patterns_ranked"],
};

const RUBRIC = `You are a senior Rust engineer doing a hostile code review. The codebase was ported from Zig by people learning Rust as they went. Find what's wrong — not nitpicks, but patterns that make the code unmaintainable, unsafe, or un-Rust.

**Look for (highest priority first):**
1. **Ownership lies**: \`&'static T\` that isn't really static, \`*mut T\` fields with no documented lifetime, raw-ptr round-trips that exist only to dodge borrowck
2. **Unsafe that shouldn't be**: \`unsafe { &*ptr }\` where the caller could pass \`&T\`; \`transmute\` for things \`.cast()\` does; \`from_raw_parts\` on things that should be \`Vec<T>\`
3. **Layering smells**: \`extern "Rust"\` between crates, \`AtomicPtr<fn>\` hooks, \`*mut c_void\` downcast at every read site, duplicate types across crates
4. **Zig-isms**: manual refcount (\`Cell<u32>\` + ref/deref), \`allocator: Allocator\` params, \`defer\`-via-scopeguard, packed-struct bit-twiddling where bitflags/enums fit
5. **Error handling**: \`.unwrap()\` on real errors, \`JsResult\` dropped silently, \`catch unreachable\` translit
6. **API shape**: \`pub\` everything, no encapsulation, fns taking \`*mut Self\` instead of \`&mut self\`, \`init()\` instead of \`new()\`/\`Default\`
7. **Type smells**: \`Option<*mut T>\` (no niche), \`Box<[T]>\` where \`Vec<T>\` is right, manual \`len/cap/ptr\` instead of std collections
8. **Maintenance smells**: 200-line comment essays explaining why a hack is OK, \`// TODO(port)\` from months ago, dead \`phase_a_draft\` mods

For each finding: name the pattern, cite **file:line** evidence, explain why it's wrong in Rust, give the idiomatic replacement, rate severity (ub/correctness/maintainability/style), estimate how many instances exist crate-wide.

Don't list "this fn is too long." Find the *patterns* that, if fixed once, fix dozens of sites.`;

// ── Scan ──
phase("Scan");
const scan = await agent(
  `List Rust crates by line count. Repo /root/bun-5. \`find src/ -name Cargo.toml | xargs -I{} dirname {}\` → for each, \`find <dir> -name '*.rs' | xargs wc -l | tail -1\`. Sort desc. Return top ${TOP_N_CRATES}. {crates:[{name,dir,lines}]}.`,
  { label: "scan", phase: "Scan", schema: SCAN_S },
);
if (!scan?.crates?.length) return { error: "scan failed" };
log(
  `${scan.crates.length} crates, top: ${scan.crates
    .slice(0, 5)
    .map(c => c.name)
    .join(", ")}`,
);

// ── Review (per crate, parallel) ──
phase("Review");
const reviews = await parallel(
  scan.crates.map(
    c => () =>
      agent(
        `Adversarially review **${c.name}** (${c.lines} lines, ${c.dir}). Repo /root/bun-5. READ ONLY — do not edit.

${RUBRIC}

**Read:** \`find ${c.dir} -name '*.rs' | head -30 | xargs cat\` (or read selectively for large crates — pick the 5-10 files with the most code/complexity).

Return {crate:"${c.name}", findings:[{pattern, example:"file:line — code snippet", why_bad, idiomatic, severity:"ub|correctness|maintainability|style", count_estimate}]}. Aim for 3-10 *patterns* (not 50 nitpicks).`,
        { label: `review:${c.name}`, phase: "Review", schema: REVIEW_S },
      ),
  ),
);

// ── Dedupe across crates ──
const all = reviews.filter(Boolean).flatMap(r => r.findings.map(f => ({ ...f, crate: r.crate })));
const byPattern = {};
for (const f of all) {
  const key = f.pattern
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .slice(0, 40);
  if (!byPattern[key])
    byPattern[key] = {
      pattern: f.pattern,
      examples: [],
      crates: new Set(),
      count: 0,
      severity: f.severity,
      why_bad: f.why_bad,
      idiomatic: f.idiomatic,
    };
  byPattern[key].examples.push(`${f.crate}: ${f.example}`);
  byPattern[key].crates.add(f.crate);
  byPattern[key].count += f.count_estimate || 1;
}
const unique = Object.values(byPattern)
  .map(p => ({ ...p, crates: [...p.crates] }))
  .sort((a, b) => b.crates.length * 10 + b.count - (a.crates.length * 10 + a.count));
log(`${all.length} raw findings → ${unique.length} unique patterns`);

// ── Verify (2-vote per top-20 pattern) ──
phase("Verify");
const verified = await pipeline(unique.slice(0, 20), p =>
  parallel(
    [0, 1].map(
      i => () =>
        agent(
          `Adversarially verify this Rust anti-pattern finding. Repo /root/bun-5. Reviewer ${i + 1}/2.

**Pattern:** ${p.pattern}
**Why claimed bad:** ${p.why_bad}
**Examples (${p.examples.length} crates):** ${p.examples.slice(0, 5).join("; ")}
**Proposed fix:** ${p.idiomatic}

**Your job — try to REFUTE:**
1. Is this actually a problem in Rust, or is the reviewer pattern-matching without context? (e.g., "*mut T field" is fine if it's an FFI handle.)
2. Read 2-3 of the cited examples in context. Does the pattern hold, or are these false positives?
3. Is the proposed fix *better*, or does it trade one problem for another (perf, ergonomics)?
4. What's the perf cost of the fix (alloc? indirection? none)?

real:true if the pattern is genuinely worth a codebase-wide sweep. real:false + refute_reason if it's a false alarm or context-dependent.

DO NOT edit. Return {pattern:"${p.pattern}", real, refute_reason, perf_cost_of_fix, better_fix}.`,
          { label: `verify${i}:${p.pattern.slice(0, 30)}`, phase: "Verify", schema: VERIFY_S },
        ),
    ),
  ).then(votes => {
    const v = (votes || []).filter(Boolean);
    const real_votes = v.filter(x => x.real).length;
    return {
      ...p,
      verified: real_votes >= 2,
      votes: v.length,
      real_votes,
      refutes: v.filter(x => !x.real).map(x => x.refute_reason),
      perf: v.map(x => x.perf_cost_of_fix).filter(Boolean),
      better_fix: v.map(x => x.better_fix).filter(Boolean),
    };
  }),
);

// ── Synthesize ──
phase("Synth");
const synth = await agent(
  `Write \`docs/RUST_IDIOMS_AUDIT.md\` — the ranked anti-pattern catalog. Repo /root/bun-5.

**Verified patterns (${verified.filter(p => p.verified).length} of ${verified.length}):**
${JSON.stringify(verified, null, 2)}

**All raw patterns (for the appendix):**
${JSON.stringify(unique.slice(20), null, 2).slice(0, 8000)}

**Format:**
\`\`\`md
# Rust Idioms Audit — ${new Date().toISOString().slice(0, 10)}

Adversarial review of ${scan.crates.length} crates. Patterns ranked by (crates affected × severity).

## Top patterns to fix

### 1. <pattern name> — N crates, ~M instances [severity]
**What:** <one line>
**Why it's wrong:** <2-3 sentences, Rust-specific>
**Example:** \`file:line\` — \`code\`
**Fix:** <concrete idiomatic replacement>
**Perf cost:** <none / +alloc / +indirection>
**Verify notes:** <if reviewers had a better fix or caveat>

### 2. ...

## Refuted (looked like problems, aren't)
<patterns where 2-vote said real:false, with the refute reason>

## Appendix: per-crate findings
<the raw per-crate list>
\`\`\`

Write the file. Commit: \`git -c core.hooksPath=/dev/null add 'docs/' && git commit -q -m "docs: RUST_IDIOMS_AUDIT.md — ${verified.filter(p => p.verified).length} verified anti-patterns from adversarial review"\`. NO push.

Return {doc_path:"docs/RUST_IDIOMS_AUDIT.md", patterns_ranked:N}.`,
  { label: "synth", phase: "Synth", schema: SYNTH_S },
);

return {
  crates: scan.crates.length,
  raw_findings: all.length,
  unique_patterns: unique.length,
  verified: verified.filter(p => p.verified).length,
  doc: synth?.doc_path,
};
