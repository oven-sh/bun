export const meta = {
  name: "phase-b2-ungate-tier",
  description:
    "Parallel per-crate un-gate: remove cfg(any()) gates, make Phase-A drafts compile. No verify (separate pass).",
  phases: [{ title: "Ungate", detail: "one agent per crate" }],
};
const REPO = "/root/bun-5";
const CRATES = (args && args.crates) || [];
if (!CRATES.length) return { error: "no crates" };

const SCHEMA = {
  type: "object",
  required: ["gates_removed", "modules_ungated", "blocked_on"],
  properties: {
    gates_removed: { type: "integer" },
    modules_ungated: {
      type: "array",
      items: { type: "string" },
      description: "file paths (relative to src/<crate>/) you un-gated — for verify pass",
    },
    blocked_on: {
      type: "array",
      items: { type: "string" },
      description: "bun_X::Symbol you needed but T0/T1 lacks — for Track A",
    },
    notes: { type: "string" },
  },
};

phase("Ungate");
const results = await pipeline(CRATES, c =>
  agent(
    `B-2 un-gate crate **${c.name}** (tier ${c.tier}). Make Phase-A draft code compile for real.

1. List \`#[cfg(any())]\` gates in \`${REPO}/src/${c.name}/lib.rs\` (and other files).
2. Per gate, smallest-first: remove gate + shadow stub → \`cargo check -p bun_${c.name.replace(/^bun_/, "")}\` → fix errors. Read the sibling \`.zig\` for ground truth. Apply PORTING.md rules (incl. §Forbidden: no Box::leak; §Pointers: Rc/Arc default not RefCounted; §Dispatch: tag+ptr not TaggedPointer; §Concurrency: OnceLock/parking_lot).
3. If blocked on missing \`bun_X::Y\` from a LOWER-tier crate: re-gate JUST that fn body, add \`// TODO(b2-blocked): bun_X::Y\`, push "bun_X::Y" to blocked_on.
4. Cap 30 cargo-check rounds. Record every file you un-gated in modules_ungated.

**HARD RULES:** Edit ONLY \`${REPO}/src/${c.name}/\`. NEVER edit T0/T1 or other crates (report blocked_on instead). NEVER git. NEVER touch .zig. NEVER Box::leak/mem::forget.`,
    { label: `ungate:${c.name}`, phase: "Ungate", schema: SCHEMA },
  ).then(r => ({
    crate: c.name,
    tier: c.tier,
    ...(r || { gates_removed: 0, modules_ungated: [], blocked_on: ["agent-null"] }),
  })),
);

return {
  tier: CRATES[0].tier,
  total_gates_removed: results.reduce((a, r) => a + r.gates_removed, 0),
  blocked_on: [...new Set(results.flatMap(r => r.blocked_on))].sort(),
  modules_ungated: results.flatMap(r =>
    r.modules_ungated.map(m => ({ crate: r.crate, file: m, zig: `src/${r.crate}/${m.replace(/\.rs$/, ".zig")}` })),
  ),
  results,
};
