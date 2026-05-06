export const meta = {
  name: "phase-b2-fix-bugs",
  description: "Apply verify-found logic bugs from a JSON file, parallel per-crate",
  phases: [{ title: "Fix", detail: "one agent per crate-with-bugs" }],
};
const REPO = "/root/bun-5";
// args: { bugs_path: "/tmp/...", or bugs: [{module,fn,what,fix}] }
const BUGS = (args && args.bugs) || [];
if (!BUGS.length) return { error: "no bugs (pass args.bugs array)" };

const SCHEMA = {
  type: "object",
  required: ["fixed"],
  properties: {
    fixed: { type: "integer" },
    skipped: { type: "array", items: { type: "string" } },
    notes: { type: "string" },
  },
};

const by_crate = {};
for (const b of BUGS) {
  const crate = b.module.split("/")[0];
  (by_crate[crate] ??= []).push(b);
}
log(`${BUGS.length} bugs across ${Object.keys(by_crate).length} crates`);

phase("Fix");
const results = await parallel(
  Object.entries(by_crate).map(
    ([crate, bugs]) =>
      () =>
        agent(
          `Fix ${bugs.length} verified logic bugs in crate **${crate}**. Each has a concrete .fix from a 2-vote adversarial verifier.

Read ${REPO}/docs/PORTING.md §Forbidden patterns (no Box::leak/mem::forget/ManuallyDrop-without-drop/unsafe lifetime-extend). Read sibling .zig for ground truth where the fix references line numbers.

Bugs (JSON):
${JSON.stringify(bugs, null, 2)}

Per bug: Read ${REPO}/src/${crate}/<file>, apply .fix via Edit. After each file: \`cd ${REPO} && rm -rf target/debug/.fingerprint/bun_* && cargo check -p bun_${crate.replace(/^bun_/, "")}\` → green.

**HARD RULES:** Edit ONLY \`${REPO}/src/${crate}/\`. **ABSOLUTE GIT BAN: NEVER run ANY git command** — not reset/checkout/stash/restore/clean. Other agents edit concurrently; broken deps are EXPECTED, ignore them. NEVER touch .zig. If a fix requires editing another crate, skip + note in skipped.`,
          { label: `fix:${crate}`, phase: "Fix", schema: SCHEMA },
        ).then(r => ({ crate, bugs: bugs.length, ...(r || { fixed: 0, skipped: ["agent-null"] }) })),
  ),
);

return {
  total_bugs: BUGS.length,
  total_fixed: results.reduce((a, r) => a + r.fixed, 0),
  by_crate: results,
};
