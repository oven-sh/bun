export const meta = {
  name: "phase-b2-fill",
  description: "Fill blocked_on symbols: per-crate, add/un-gate the requested symbols",
  phases: [{ title: "Fill", detail: "one agent per crate-with-symbols" }],
};
const REPO = "/root/bun-5";
// args: { symbols: ["bun_X::Symbol", ...] }
const SYMS = (args && args.symbols) || [];
if (!SYMS.length) return { error: "no symbols" };

const SCHEMA = {
  type: "object",
  required: ["added", "modules_touched"],
  properties: {
    added: { type: "integer" },
    modules_touched: { type: "array", items: { type: "string" } },
    skipped: { type: "array", items: { type: "string" } },
    notes: { type: "string" },
  },
};
const dir_for = c => ({ bun_str: "string", bun_core: "bun_core", bun_alloc: "bun_alloc" })[c] || c.replace(/^bun_/, "");

const by_crate = {};
for (const s of SYMS) {
  const crate = s.split("::")[0];
  (by_crate[crate] ??= []).push(s);
}
log(`${SYMS.length} symbols across ${Object.keys(by_crate).length} crates`);

phase("Fill");
const results = await parallel(
  Object.entries(by_crate).map(
    ([crate, syms]) =>
      () =>
        agent(
          `Add/un-gate ${syms.length} requested symbols in crate **${crate}** (dir: ${REPO}/src/${dir_for(crate)}/). These are symbols downstream crates need but are missing/stubbed.

Symbols:
${syms.map(s => `- ${s}`).join("\n")}

Per symbol:
- If it's a gated fn/method/type: un-gate it. Read sibling .zig for impl truth.
- If it's an extern (\`*_sys\` crates): add \`extern "C" { fn X(...) -> ...; }\`. Read .zig FFI block or vendor C header for sig.
- If it's a method on an existing type: add to the impl block. Read .zig.
- If "X::Y::Z" path doesn't exist: figure out what the caller actually needs (maybe Z is a re-export, or the path changed).
- If genuinely can't add (depends on something else gated): skip + note why.

\`cd ${REPO} && rm -rf target/debug/.fingerprint/bun_* && cargo check -p ${crate}\` after each batch. Read ${REPO}/docs/PORTING.md (§Forbidden, §Dispatch, §Allocators, §Concurrency).

**HARD RULES:** Edit ONLY \`${REPO}/src/${dir_for(crate)}/\`. **ABSOLUTE GIT BAN: NEVER run ANY git command** — not reset/checkout/stash/restore/clean. Other agents edit concurrently; broken deps are EXPECTED, ignore them. NEVER touch .zig. NEVER Box::leak/mem::forget. Record touched file paths (relative to crate dir) in modules_touched.`,
          { label: `fill:${crate}`, phase: "Fill", schema: SCHEMA },
        ).then(r => ({
          crate,
          requested: syms.length,
          ...(r || { added: 0, modules_touched: [], skipped: ["agent-null"] }),
        })),
  ),
);

return {
  total_requested: SYMS.length,
  total_added: results.reduce((a, r) => a + r.added, 0),
  by_crate: results,
  modules: results.flatMap(r =>
    r.modules_touched.map(f => ({
      crate: dir_for(r.crate),
      file: f,
      zig: `src/${dir_for(r.crate)}/${f.replace(/\.rs$/, ".zig")}`,
    })),
  ),
};
