export const meta = {
  name: "phase-b0-cyclebreak",
  description: "Classify every back-edge in the crate DAG: DELETE / TYPE_ONLY / MOVE_DOWN / GENUINE",
  phases: [
    { title: "Classify", detail: "one agent per back-edge: read refs, classify each symbol" },
    { title: "Synthesize", detail: "aggregate by action; produce delete-list + refactor-list" },
  ],
};

const REPO = "/root/bun-5";
const EDGES = (args && args.edges) || []; // [{from, to, from_tier, to_tier, refs:[{file,symbols}]}]
if (!EDGES.length) return { error: "no edges" };
log(`B-0: classifying ${EDGES.length} back-edges`);

const SCHEMA = {
  type: "object",
  required: ["symbols"],
  properties: {
    symbols: {
      type: "array",
      items: {
        type: "object",
        required: ["symbol", "action", "reason"],
        properties: {
          symbol: { type: "string", description: "the bun_<to>::<symbol> being classified" },
          action: {
            enum: ["DELETE", "TYPE_ONLY", "MOVE_DOWN", "FORWARD_DECL", "GENUINE"],
            description:
              "DELETE=remove the use, dead/over-import/alias-leftover. TYPE_ONLY=only the type definition is needed, move it to a leaf crate. MOVE_DOWN=the symbol belongs in <from> (or a lower tier), move it. FORWARD_DECL=only need an opaque ptr, replace with *const ()/newtype. GENUINE=actually needs <to>'s logic; needs trait indirection or accept the dep.",
          },
          reason: { type: "string", description: "≤120 chars: what the usage actually does" },
          replacement: { type: "string", description: "for DELETE/FORWARD_DECL: what to write instead (or empty)" },
          move_to: { type: "string", description: "for TYPE_ONLY/MOVE_DOWN: which crate the symbol should live in" },
        },
      },
    },
  },
};

phase("Classify");
const results = await pipeline(EDGES, e => {
  const refList = e.refs.map(r => `  ${r.file}: ${r.symbols.join(", ")}`).join("\n");
  const allSyms = [...new Set(e.refs.flatMap(r => r.symbols))];
  return agent(
    `Classify a crate-dependency back-edge so we can break the cycle.

Edge: **${e.from} (T${e.from_tier}) → ${e.to} (T${e.to_tier})** — wrong direction (low tier depends on high tier).

References in src/${e.from}/ that pull in bun_${e.to.replace(/^bun_/, "")}:
${refList}

For EACH symbol (${allSyms.join(", ")}), read the actual usage in those files (Read or grep -n the ref'd files) and classify:

- **DELETE** — the use is dead, an over-import, or a Phase-A alias leftover (\`pub use bun_X_jsc::foo\` from the Zig \`pub const toJS = @import\` pattern — PORTING.md said delete these). Also DELETE if it's only used in a doc comment or trailer.
- **TYPE_ONLY** — only the struct/enum *definition* is needed (no methods called). Propose move_to = a tier-≤${e.from_tier} crate (often \`${e.from}\` itself, or \`options_types\`/\`http_types\`/etc).
- **MOVE_DOWN** — the symbol's *implementation* logically belongs in ${e.from} or lower (e.g., a path helper in resolver that paths/ calls).
- **FORWARD_DECL** — only stored/passed as an opaque pointer; replace with \`*const ()\` or a local newtype.
- **GENUINE** — ${e.from} actually invokes ${e.to}'s logic. Rare for T0-T2 sources. Needs trait indirection or feature-gate.

Heuristics:
- T0 ${e.from_tier === 0 ? "(this crate!)" : ""} crates (bun_core, bun_alloc, *_sys, ptr, safety) should depend on NOTHING. Nearly every symbol here is DELETE or FORWARD_DECL.
- \`X → X_jsc\` edges: always DELETE (alias leftover).
- \`*_sys → <anything non-sys>\`: always DELETE or FORWARD_DECL (sys crates are pure FFI).
- Symbols like \`JSValue\`, \`JSGlobalObject\`, \`VirtualMachine\`, \`CallFrame\` in non-jsc crates: DELETE (alias leftover) or the whole fn should be in a *_jsc crate.

Do NOT edit files. Read-only. Return one entry per distinct symbol.`,
    { label: `edge:${e.from}→${e.to}`, phase: "Classify", schema: SCHEMA },
  ).then(r => ({
    edge: `${e.from}→${e.to}`,
    from: e.from,
    to: e.to,
    from_tier: e.from_tier,
    refs: e.refs,
    ...(r || { symbols: [] }),
  }));
});

phase("Synthesize");
const flat = results.flatMap(r =>
  r.symbols.map(s => ({ ...s, edge: r.edge, from: r.from, to: r.to, from_tier: r.from_tier, refs: r.refs })),
);
const byAction = {};
for (const s of flat) (byAction[s.action] ??= []).push(s);

return {
  edges: EDGES.length,
  symbols: flat.length,
  by_action: Object.fromEntries(Object.entries(byAction).map(([k, v]) => [k, v.length])),
  // DELETE list grouped by source crate (so main loop edits one crate at a time, no conflicts)
  deletes: Object.entries(
    (byAction.DELETE || []).reduce((m, s) => {
      (m[s.from] ??= []).push({
        to: s.to,
        symbol: s.symbol,
        files: s.refs.filter(r => r.symbols.includes(s.symbol)).map(r => r.file),
        replacement: s.replacement || "",
        reason: s.reason,
      });
      return m;
    }, {}),
  ).map(([crate, items]) => ({ crate, items })),
  type_only: byAction.TYPE_ONLY || [],
  move_down: byAction.MOVE_DOWN || [],
  forward_decl: byAction.FORWARD_DECL || [],
  genuine: byAction.GENUINE || [],
};
