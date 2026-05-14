export const meta = {
  name: "phase-b0-moveout",
  description:
    "Per-source-crate: replace every upward bun_<higher>:: ref with vtable/tag+ptr/forward-decl/re-import per CYCLEBREAK.md",
  phases: [{ title: "MoveOut", detail: "one agent per T0-T5 source crate, edits only src/<crate>/" }],
};

const REPO = "/root/bun-5";
const CRATES = (args && args.crates) || []; // [{name, tier}]
if (!CRATES.length) return { error: "no crates" };
log(`B-0 move-out: ${CRATES.length} source crates`);

const SCHEMA = {
  type: "object",
  required: ["edits", "remaining_upward_refs", "notes"],
  properties: {
    edits: { type: "integer" },
    remaining_upward_refs: {
      type: "integer",
      description: "count of bun_<higher>:: refs you could NOT remove (need move-in pass first)",
    },
    skipped: { type: "array", items: { type: "string" } },
    notes: { type: "string", description: "one paragraph: what you converted to vtable/tag+ptr, what blocked" },
  },
};

phase("MoveOut");
const results = await pipeline(CRATES, c =>
  agent(
    `You own crate **${c.name}** (tier ${c.tier}). Remove every upward dependency so it depends only on tier ≤${c.tier} crates.

**HARD RULES — violating any of these poisons the whole pass:**
- Edit ONLY files under \`${REPO}/src/${c.name}/\`. Never touch another crate's files.
- NEVER run git (no add/commit/push/reset/checkout/stash/clean).
- NEVER delete a file. Only Edit existing .rs.
- If a fix requires adding code to ANOTHER crate (vtable static, dispatch fn, moved type) — do NOT add it. Replace your side with the forward reference (\`crate_name::Symbol\` even if it doesn't exist yet) and note it in \`skipped\`. The move-in pass adds it.

**Steps:**
1. Read \`${REPO}/docs/CYCLEBREAK.md\` — find your section "### \`${c.name}\` (T${c.tier}, ...)" under "Per-source-crate move-out tasks". That's your task list.
2. Read \`${REPO}/docs/PORTING.md\` lines 352-415 (§Dispatch) for the vtable / tag+ptr / hook-registration patterns.
3. \`grep -rn 'bun_[a-z_]*::' ${REPO}/src/${c.name} --include='*.rs'\` — every match where the target crate is tier >${c.tier} must go.
4. For each upward ref, apply per CYCLEBREAK.md classification:
   - **vtable** (cold dispatch): replace the union-enum struct with \`{owner: *mut (), vtable: &'static XxxVTable}\`; define \`pub struct XxxVTable { pub method: unsafe fn(*mut (), ...), ... }\` in THIS crate. Delete the variant-type imports.
   - **tag+ptr** (hot dispatch — Task/FilePoll/Timer/Source/WorkPoolTask): replace with \`{tag: XxxTag(u8), ptr: *mut ()}\`; define \`#[repr(transparent)] pub struct XxxTag(pub u8);\`. Delete variant imports. The match-loop moves to runtime (move-in pass).
   - **hook**: define \`pub static XXX_HOOK: AtomicPtr<()> = AtomicPtr::new(null_mut());\` and replace the call with a load+cast+call through it.
   - **forward-decl**: replace with \`*const ()\` or local opaque newtype.
   - **re-import**: change \`bun_jsc::AnyEventLoop\` → \`bun_event_loop::AnyEventLoop\` etc. (same-or-lower tier source).
   - **type moved**: change \`bun_resolver::GlobalCache\` → \`bun_options_types::GlobalCache\` (the move-in pass will put it there).
5. After edits: \`grep -rn 'bun_[a-z_]*::' ${REPO}/src/${c.name} --include='*.rs' | wc -l\` and report remaining (should be only tier-≤${c.tier} refs + comments).

Return structured output.`,
    { label: `moveout:${c.name}`, phase: "MoveOut", schema: SCHEMA },
  ).then(r => ({
    crate: c.name,
    tier: c.tier,
    ...(r || { edits: 0, remaining_upward_refs: -1, skipped: ["agent-null"], notes: "" }),
  })),
);

const total_edits = results.reduce((a, r) => a + r.edits, 0);
const blocked = results.filter(r => r.remaining_upward_refs > 0);
return {
  crates: CRATES.length,
  total_edits,
  blocked_crates: blocked.map(r => ({ crate: r.crate, remaining: r.remaining_upward_refs })),
  results,
};
