export const meta = {
  name: "phase-b0-movein",
  description:
    "Per-target-crate: add moved-down types/vtable statics/dispatch fns/hook registrations that move-out forward-refs point at",
  phases: [{ title: "MoveIn", detail: "one agent per target crate, edits only src/<target>/, no new files" }],
};

const REPO = "/root/bun-5";
const TARGETS = (args && args.targets) || []; // [{name, cyclebreak_key}]
if (!TARGETS.length) return { error: "no targets" };
log(`B-0 move-in: ${TARGETS.length} target crates`);

const SCHEMA = {
  type: "object",
  required: ["edits", "added_symbols", "notes"],
  properties: {
    edits: { type: "integer" },
    added_symbols: { type: "array", items: { type: "string" } },
    skipped: { type: "array", items: { type: "string" }, description: "items you could not add (reason)" },
    notes: { type: "string", description: "one paragraph: what you added, where, any signature decisions" },
  },
};

phase("MoveIn");
const results = await pipeline(TARGETS, t =>
  agent(
    `You own target crate **${t.name}**. Add the symbols that move-out's forward-refs point at, so lower-tier crates can resolve them here.

**HARD RULES — violating any poisons the pass:**
- Edit ONLY files under \`${REPO}/src/${t.name}/\`. Never touch another crate.
- NEVER run git. NEVER touch .zig. NEVER create new files (only Edit existing .rs — typically lib.rs or the most-related module).
- Extract symbol BODIES from the source crate's **.zig** (ground truth), not its .rs (may already be edited by move-out).

**Your task list:**
1. Read \`${REPO}/docs/CYCLEBREAK.md\` — find section "### → \\\`${t.cyclebreak_key}\\\`" under "Per-target-crate move-in tasks". That lists \`from <crate>: <symbol>, ...\` entries.
2. \`grep -iE '\\b(${t.name}|${t.cyclebreak_key}|bun_${t.cyclebreak_key})\\b' /tmp/movein-skipped.txt\` — these are explicit "move-in pass must add X to ${t.name}" requests from move-out agents. Higher priority than CYCLEBREAK.md (more specific).
3. Read \`${REPO}/docs/PORTING.md\` §Dispatch (lines ~377-440) and §Concurrency (lines ~352-376) for vtable/hook/OnceLock patterns.

**For each symbol to add:**
- **TYPE_ONLY** (struct/enum def): copy the type definition from the source .zig, port per PORTING.md type map, add to lib.rs (or most-related .rs). Add \`pub use\` if it should be re-exported under the old path.
- **MOVE_DOWN** (fn/helper): copy the fn body from source .zig, port it. If it calls back into the source crate, that's now a FORWARD dep (allowed — target tier ≥ source tier).
- **VTable static**: e.g. "bun_sys must provide OUTPUT_SINK_VTABLE" → add \`pub static OUTPUT_SINK: <low_tier>::OutputSinkVTable = <low_tier>::OutputSinkVTable { write_all: |fd, b| ..., ... };\` with REAL impls (not unreachable!). Read the vtable struct def in the low-tier crate to get the slot signatures.
- **Hook registration**: add a \`pub fn install_hooks()\` (or extend existing init fn) that writes fn-ptrs into the low-tier crate's \`static HOOK: AtomicPtr<()>\`.
- **Hot dispatch fn**: e.g. "runtime must own run_tasks() match loop" — SKIP (tier-6, Pass C handles).

**Triage:**
- If a symbol's source .zig shows it depends on tier-6 (jsc/runtime/bake) → SKIP, note "deferred to Pass C".
- If the CYCLEBREAK entry is vague/malformed (e.g. \`stays\`, path-style targets) → SKIP, note why.
- If adding would require a NEW .rs file → SKIP, note "needs new file (forbidden)".

After edits: list every symbol you added. Return structured output.`,
    { label: `movein:${t.name}`, phase: "MoveIn", schema: SCHEMA },
  ).then(r => ({ crate: t.name, ...(r || { edits: 0, added_symbols: [], skipped: ["agent-null"], notes: "" }) })),
);

const total_edits = results.reduce((a, r) => a + r.edits, 0);
const total_symbols = results.reduce((a, r) => a + r.added_symbols.length, 0);
return { targets: TARGETS.length, total_edits, total_symbols, results };
