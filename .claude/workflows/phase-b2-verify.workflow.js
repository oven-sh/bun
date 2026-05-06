export const meta = {
  name: "phase-b2-verify",
  description: "Verify un-gated B-2 modules against .zig siblings: logic correctness, not just type-check",
  phases: [{ title: "Verify", detail: "one agent per un-gated module: diff .rs vs .zig for behavior divergence" }],
};

const REPO = "/root/bun-5";
const MODULES = (args && args.modules) || []; // [{crate, file, zig}]
if (!MODULES.length) return { error: "no modules" };

const SCHEMA = {
  type: "object",
  required: ["ok", "issues"],
  properties: {
    ok: { type: "boolean" },
    issues: {
      type: "array",
      items: {
        type: "object",
        required: ["fn", "severity", "what"],
        properties: {
          fn: { type: "string" },
          severity: { enum: ["logic-bug", "incomplete", "perf", "nit"] },
          what: { type: "string", description: ".rs does X but .zig does Y — be specific" },
          fix: { type: "string" },
        },
      },
    },
  },
};

const REFUTE_SCHEMA = {
  type: "object",
  required: ["confirmed"],
  properties: {
    confirmed: { type: "boolean", description: "true = this IS a real bug; false = verifier was wrong" },
    reason: { type: "string" },
  },
};

phase("Verify");
const results = await pipeline(MODULES, async m => {
  // 2-vote: two independent verifiers
  const [a, b] = await parallel([0, 1].map(i => () => verifyOnce(m, i)));
  const aIssues = (a && a.issues) || [];
  const bIssues = (b && b.issues) || [];
  // bug key for dedup
  const key = x => `${x.fn}|${x.severity}|${(x.what || "").slice(0, 80)}`;
  const aKeys = new Set(aIssues.map(key));
  const bKeys = new Set(bIssues.map(key));
  const agreed = aIssues.filter(x => bKeys.has(key(x))); // both found it
  const disputed = [...aIssues.filter(x => !bKeys.has(key(x))), ...bIssues.filter(x => !aKeys.has(key(x)))].filter(
    x => x.severity === "logic-bug",
  ); // only tiebreak logic-bugs
  // tiebreak: 3rd agent refutes each disputed bug
  const tiebroken = await parallel(
    disputed.map(
      d => () =>
        agent(
          `One verifier claims this is a logic bug; another did not flag it. You are the tiebreaker. Default to confirmed=false unless you can verify it against the .zig.\n\nModule: ${m.crate}/${m.file} vs ${m.zig}\nClaimed bug in fn \`${d.fn}\`:\n${d.what}\n\nRead both files. Is this a REAL divergence from .zig behavior?`,
          { label: `tiebreak:${m.crate}/${d.fn}`, phase: "Verify", schema: REFUTE_SCHEMA },
        ).then(r => (r && r.confirmed ? d : null)),
    ),
  );
  const final = [...agreed, ...tiebroken.filter(Boolean)];
  // non-logic-bug issues: union without tiebreak
  const other = [...aIssues, ...bIssues].filter(
    (x, i, arr) => x.severity !== "logic-bug" && arr.findIndex(y => key(y) === key(x)) === i,
  );
  return { ...m, ok: final.length === 0, issues: [...final, ...other] };
});

function verifyOnce(m, idx) {
  return agent(
    `Adversarially verify a B-2 un-gated module against its .zig sibling. The .rs compiles — your job is finding where it does the WRONG thing.

Module: ${m.crate}/${m.file}
Read: ${REPO}/src/${m.crate}/${m.file}
Read: ${REPO}/${m.zig}

For each pub fn that's not \`todo!()\`-gated, compare logic to the .zig fn of the same name:
- **logic-bug**: .rs returns wrong value / wrong branch / off-by-one / inverted condition / wrong arithmetic vs .zig
- **logic-bug**: \`Box::leak\` / \`mem::forget\` / \`ManuallyDrop\` without paired drop / \`unsafe\` lifetime-extend — see PORTING.md §Forbidden patterns. The Zig freed it; Rust must too. Retype the field, don't leak.
- **incomplete**: .rs has a \`todo!()\`/\`// TODO\` where .zig has real logic that COULD be ported (no higher-tier dep)
- **perf**: .rs uses scalar where .zig uses SIMD/highway (and the FFI is available); .rs allocates where .zig doesn't
- **nit**: naming, comment drift

Ignore: anything already \`#[cfg(any())]\`-gated, \`// TODO(b2-blocked)\`, or where the .rs intentionally diverges per PORTING.md (Drop vs deinit, Vec vs ArrayList, no allocator param).

Be specific: "fn foo: .rs returns \`len\` but .zig returns \`len - 1\` (line N)". Default ok=false if ANY logic-bug.`,
    { label: `verify[${idx}]:${m.crate}/${m.file}`, phase: "Verify", schema: SCHEMA },
  );
}

const bugs = results.flatMap(r =>
  r.issues.filter(i => i.severity === "logic-bug").map(i => ({ ...i, module: `${r.crate}/${r.file}` })),
);
return {
  modules: MODULES.length,
  ok: results.filter(r => r.ok).length,
  logic_bugs: bugs.length,
  bugs,
  incomplete: results.flatMap(r =>
    r.issues.filter(i => i.severity === "incomplete").map(i => ({ ...i, module: `${r.crate}/${r.file}` })),
  ),
  perf: results.flatMap(r =>
    r.issues.filter(i => i.severity === "perf").map(i => ({ ...i, module: `${r.crate}/${r.file}` })),
  ),
};
