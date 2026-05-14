export const meta = {
  name: "phase-b2-cycle",
  description: "One full B-2 cycle: per-tier ungate → 2-vote verify → fix. Returns results for main loop to commit.",
  phases: [
    { title: "Ungate", detail: "per-crate, parallel" },
    { title: "Verify", detail: "2-vote+tiebreak per module" },
    { title: "Fix", detail: "per-crate, parallel" },
  ],
};
const REPO = "/root/bun-5";
// args: { tiers: [{n: 2, crates: [...]}], mode: 'ungate'|'fill', fill_symbols_path?: string }
const TIERS = (args && args.tiers) || [];
if (!TIERS.length) return { error: "no tiers" };

const UNGATE_SCHEMA = {
  type: "object",
  required: ["gates_removed", "modules_ungated", "blocked_on"],
  properties: {
    gates_removed: { type: "integer" },
    modules_ungated: { type: "array", items: { type: "string" } },
    blocked_on: { type: "array", items: { type: "string" } },
    notes: { type: "string" },
  },
};
const VERIFY_SCHEMA = {
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
          what: { type: "string" },
          fix: { type: "string" },
        },
      },
    },
  },
};
const REFUTE_SCHEMA = {
  type: "object",
  required: ["confirmed"],
  properties: { confirmed: { type: "boolean" }, reason: { type: "string" } },
};
const FIX_SCHEMA = {
  type: "object",
  required: ["fixed"],
  properties: { fixed: { type: "integer" }, notes: { type: "string" } },
};

const all_results = [];
for (const tier of TIERS) {
  log(`═══ Tier ${tier.n} (${tier.crates.length} crates) ═══`);

  // ── Ungate (parallel per-crate) ──
  phase("Ungate");
  const ungate = await parallel(
    tier.crates.map(
      c => () =>
        agent(
          `B-2 un-gate crate **${c}** (tier ${tier.n}). Remove \`#[cfg(any())]\` gates and make Phase-A draft code compile.

1. List gates: \`grep -n '#\\[cfg(any())\\]' ${REPO}/src/${c}/\`.
2. Per gate (smallest-first): remove gate + shadow stub → \`cd ${REPO} && cargo check -p bun_${c.replace(/^bun_/, "")}\` → fix errors. Read sibling \`.zig\` for ground truth. Apply ${REPO}/docs/PORTING.md rules (§Forbidden: no Box::leak/forget/lifetime-extend; §Pointers: Rc/Arc default; §Dispatch: tag+ptr; §Concurrency: OnceLock/parking_lot; §Allocators: AST=bumpalo, else Vec).
3. If blocked on missing \`bun_X::Y\` from lower tier: re-gate JUST that fn body, push "bun_X::Y" to blocked_on.
4. Cap 30 cargo rounds. Record un-gated file paths in modules_ungated.

**HARD RULES:** Edit ONLY \`${REPO}/src/${c}/\`. NEVER git. NEVER touch .zig. NEVER Box::leak/mem::forget/transmute-lifetime.`,
          { label: `ungate:${c}`, phase: "Ungate", schema: UNGATE_SCHEMA },
        ).then(r => ({ crate: c, ...(r || { gates_removed: 0, modules_ungated: [], blocked_on: ["agent-null"] }) })),
    ),
  );
  const modules = ungate.flatMap(r =>
    r.modules_ungated.map(f => ({ crate: r.crate, file: f, zig: `src/${r.crate}/${f.replace(/\.rs$/, ".zig")}` })),
  );
  const blocked_on = [...new Set(ungate.flatMap(r => r.blocked_on))].sort();
  const total_gates = ungate.reduce((a, r) => a + r.gates_removed, 0);
  log(`Tier ${tier.n} ungate: ${total_gates} gates, ${modules.length} modules, ${blocked_on.length} blocked_on`);

  // ── Verify (2-vote + tiebreak per module) ──
  phase("Verify");
  const verifyPrompt = m =>
    `Adversarially verify B-2 module against .zig sibling. The .rs compiles — find where it does the WRONG thing.

Read: ${REPO}/src/${m.crate}/${m.file}
Read: ${REPO}/${m.zig}

For each pub fn not \`todo!()\`-gated, compare vs .zig fn:
- **logic-bug**: wrong value/branch/off-by-one/inverted condition vs .zig; OR \`Box::leak\`/\`mem::forget\`/\`ManuallyDrop\` without paired drop / unsafe lifetime-extend (PORTING.md §Forbidden)
- **incomplete**: \`todo!()\` where .zig has real logic with no higher-tier dep
- **perf**: scalar where .zig uses SIMD; allocates where .zig doesn't
Ignore: \`#[cfg(any())]\`-gated, \`TODO(b2-blocked)\`, intentional PORTING.md divergences (Drop vs deinit, Vec vs ArrayList, no allocator). Be specific. ok=false if ANY logic-bug.`;
  const verified = await pipeline(modules, async m => {
    const [a, b] = await parallel(
      [0, 1].map(
        i => () =>
          agent(verifyPrompt(m), {
            label: `verify[${i}]:${m.crate}/${m.file}`,
            phase: "Verify",
            schema: VERIFY_SCHEMA,
          }),
      ),
    );
    const key = x => `${x.fn}|${(x.what || "").slice(0, 80)}`;
    const aBugs = ((a && a.issues) || []).filter(x => x.severity === "logic-bug");
    const bBugs = ((b && b.issues) || []).filter(x => x.severity === "logic-bug");
    const aK = new Set(aBugs.map(key));
    const bK = new Set(bBugs.map(key));
    const agreed = aBugs.filter(x => bK.has(key(x)));
    const disputed = [...aBugs.filter(x => !bK.has(key(x))), ...bBugs.filter(x => !aK.has(key(x)))];
    const tiebroken = await parallel(
      disputed.map(
        d => () =>
          agent(
            `Tiebreaker. One verifier flagged this; another didn't. Default confirmed=false unless you verify against .zig.\nModule: ${m.crate}/${m.file} vs ${m.zig}\nBug in fn \`${d.fn}\`: ${d.what}\nIs this a REAL divergence?`,
            { label: `tiebreak:${m.crate}/${d.fn}`, phase: "Verify", schema: REFUTE_SCHEMA },
          ).then(r => (r && r.confirmed ? d : null)),
      ),
    );
    return { ...m, bugs: [...agreed, ...tiebroken.filter(Boolean)] };
  });
  const all_bugs = verified.flatMap(v => v.bugs.map(b => ({ ...b, crate: v.crate, file: v.file })));
  log(`Tier ${tier.n} verify: ${all_bugs.length} logic bugs`);

  // ── Fix (parallel per-crate-with-bugs) ──
  phase("Fix");
  const by_crate = {};
  for (const b of all_bugs) (by_crate[b.crate] ??= []).push(b);
  const fixed = await parallel(
    Object.entries(by_crate).map(
      ([crate, bugs]) =>
        () =>
          agent(
            `Fix ${bugs.length} logic bugs in crate **${crate}**. Each has a concrete .fix.

Bugs (JSON):
${JSON.stringify(bugs, null, 2)}

Read ${REPO}/docs/PORTING.md §Forbidden. Read sibling .zig for truth. Apply each .fix via Edit. \`cargo check -p bun_${crate.replace(/^bun_/, "")}\` after. Edit ONLY \`${REPO}/src/${crate}/\`. NEVER git, NEVER .zig.`,
            { label: `fix:${crate}`, phase: "Fix", schema: FIX_SCHEMA },
          ).then(r => ({ crate, ...(r || { fixed: 0 }) })),
    ),
  );

  all_results.push({
    tier: tier.n,
    gates_removed: total_gates,
    blocked_on,
    bugs_found: all_bugs.length,
    bugs_fixed: fixed.reduce((a, r) => a + r.fixed, 0),
    modules: modules.length,
  });
}

return {
  tiers: all_results,
  total_gates: all_results.reduce((a, r) => a + r.gates_removed, 0),
  total_bugs: all_results.reduce((a, r) => a + r.bugs_found, 0),
  blocked_on_all: [...new Set(all_results.flatMap(r => r.blocked_on))].sort(),
};
