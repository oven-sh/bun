export const meta = {
  name: "phase-f-accessor-sweep",
  description:
    "Per-struct: find raw-ptr fields → add safe accessor → sed callers → 2-vote review (aliasing/null/lifetime)",
  phases: [
    { title: "Survey", detail: "find top-N structs with most unsafe { &*self.field } derefs" },
    { title: "Accessor", detail: "add safe accessor + sed callers for one struct" },
    { title: "Review", detail: "2-vote: aliasing UB? null? lifetime? re-entrancy?" },
    { title: "Fix", detail: "apply reviewer findings" },
  ],
};

const A = typeof args === "string" ? JSON.parse(args) : args || {};
const WT = A.worktree || "/root/bun-5-accessor-sweep";
const MAX_ROUNDS = A.max_rounds || 4;
const STRUCTS_PER_ROUND = A.structs_per_round || 12;

const SURVEY_S = {
  type: "object",
  properties: {
    structs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          struct: { type: "string" },
          file: { type: "string" },
          ptr_fields: { type: "array", items: { type: "string" } },
          deref_count: { type: "number" },
        },
        required: ["struct", "file", "deref_count"],
      },
    },
    total_derefs: { type: "number" },
  },
  required: ["structs", "total_derefs"],
};
const ACC_S = {
  type: "object",
  properties: {
    struct: { type: "string" },
    accessors_added: { type: "array", items: { type: "string" } },
    callers_converted: { type: "number" },
    unsafe_removed: { type: "number" },
    commit: { type: "string" },
    risk_notes: { type: "string" },
    notes: { type: "string" },
  },
  required: ["struct", "accessors_added", "callers_converted", "commit"],
};
const REVIEW_S = {
  type: "object",
  properties: {
    accept: { type: "boolean" },
    bugs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          accessor: { type: "string" },
          what: { type: "string" },
          why_ub: { type: "string" },
          fix: { type: "string" },
          severity: { type: "string" },
        },
        required: ["accessor", "what", "fix", "severity"],
      },
    },
  },
  required: ["accept", "bugs"],
};
const FIX_S = {
  type: "object",
  properties: { bugs_fixed: { type: "number" }, commit: { type: "string" } },
  required: ["bugs_fixed"],
};

const HARD = `**HARD RULES:** Work ONLY in ${WT} on branch claude/phase-f-accessor-sweep. Never git reset/checkout/stash/rebase/pull. Commit only. NO push.`;

let history = [];
let done_structs = new Set();

for (let round = 1; round <= MAX_ROUNDS; round++) {
  phase("Survey");
  const survey = await agent(
    `Survey: find structs with raw-ptr fields and count unsafe derefs of those fields. Repo ${WT}.

1. Find structs with \`*mut T\` / \`*const T\` / \`NonNull<T>\` fields: \`grep -rn 'pub.*: \\*mut\\|pub.*: \\*const\\|: NonNull<' ${WT}/src/ --include='*.rs' -B5 | grep -oP 'struct \\K\\w+' | sort | uniq\`
2. For each struct's ptr fields, count: \`grep -rn 'unsafe { &\\*self\\.<field>\\|unsafe { &mut \\*self\\.<field>\\|unsafe { (\\*self\\.<field>)' ${WT}/src/\` (and \`this.field\`, \`(*this).field\` patterns)
3. EXCLUDE structs already done: ${JSON.stringify([...done_structs])}
4. Sort by deref_count desc. Top ${STRUCTS_PER_ROUND}.

Return {structs:[{struct, file, ptr_fields:[...], deref_count}], total_derefs}. DO NOT edit.`,
    { label: `survey-r${round}`, phase: "Survey", schema: SURVEY_S },
  );
  if (!survey || survey.structs.length === 0) return { rounds: round, done: true, history };

  log(`r${round}: ${survey.structs.length} structs, ${survey.total_derefs} total derefs`);

  await pipeline(
    survey.structs,
    s =>
      agent(
        `Add safe accessors to **${s.struct}** (${s.file}). Repo ${WT}. ${s.deref_count} unsafe derefs of fields: ${(s.ptr_fields || []).join(", ")}.

**For each ptr field:**
1. **Analyze the invariant**: when is this pointer valid? Can it be null? Is the pointee mutated while a \`&T\` would be live (re-entrancy)? Read the struct's usage + .zig spec.
2. **Choose accessor type:**
   - Never-null, immutable read: \`fn x(&self) -> &T { unsafe { &*self.x } }\` + SAFETY comment
   - Can be null: \`fn x(&self) -> Option<&T> { unsafe { self.x.as_ref() } }\`
   - Mutated across callbacks (re-entrancy): \`fn x_ptr(&self) -> *mut T { self.x }\` (DON'T add &-returning accessor — note in risk_notes)
   - Mutable single-access: \`fn x_mut(&mut self) -> &mut T { unsafe { &mut *self.x } }\`
3. **Sed callers**: \`unsafe { &*self.x }\` → \`self.x()\`, \`unsafe { (*self.x).f }\` → \`self.x().f\`.
4. \`cargo check -p <crate>\` → fix.
5. Commit.

**risk_notes**: list any field where you chose NOT to add a &-accessor (re-entrancy/aliasing risk).

${HARD}

Return {struct:"${s.struct}", accessors_added:[...], callers_converted:N, unsafe_removed:N, commit, risk_notes, notes}.`,
        { label: `acc:${s.struct}`, phase: "Accessor", schema: ACC_S },
      ),
    (acc, s) =>
      acc
        ? parallel(
            [0, 1].map(
              i => () =>
                agent(
                  `Adversarially review accessors added to **${s.struct}**. Repo ${WT} @ HEAD.

Accessors: ${(acc.accessors_added || []).join(", ")}. Risk notes: ${acc.risk_notes || "none"}.

**For each &-returning accessor, check:**
1. **Aliasing UB**: Is the pointee mutated (by a JS callback, another method, the event loop) while a \`&T\` from this accessor could be live? If yes → UB.
2. **Null**: Can the field be null when the accessor is called? Find init paths.
3. **Lifetime**: Does \`&self\` outlive the pointee? (e.g., field set from a fn arg that the struct doesn't own)
4. **Spec**: Does .zig hold this as \`*T\` (alias-allowed) or is it Rust-safe?

**accept:true** ONLY if no aliasing/null/lifetime UB. List bugs otherwise.

DO NOT edit. Return {accept, bugs:[{accessor, what, why_ub, fix, severity}]}.`,
                  { label: `rev${i}:${s.struct}`, phase: "Review", schema: REVIEW_S },
                ),
            ),
          ).then(votes => {
            const bugs = (votes || []).filter(Boolean).flatMap(v => v.bugs || []);
            const dedup = [];
            const seen = {};
            for (const b of bugs) {
              const k = `${b.accessor}::${(b.what || "").slice(0, 50)}`;
              if (!seen[k]) {
                seen[k] = 1;
                dedup.push(b);
              }
            }
            const accepted = (votes || []).filter(Boolean).length >= 2 && votes.every(v => v && v.accept);
            return { struct: s.struct, acc, accepted, bugs: dedup };
          })
        : null,
    (vr, s) =>
      vr && !vr.accepted && vr.bugs.length > 0
        ? agent(
            `Fix accessor bugs for **${s.struct}**. Repo ${WT}.

**${vr.bugs.length} bugs:**
${vr.bugs.map((b, i) => `${i + 1}. [${b.severity}] **${b.accessor}**: ${b.what}\n   WHY UB: ${b.why_ub}\n   FIX: ${b.fix}`).join("\n")}

For aliasing-UB accessors: remove the &-accessor, keep callers using raw \`unsafe { (*ptr).f }\` per-access (that's correct). For null: add Option<>. For lifetime: document or remove.

${HARD}

Return {bugs_fixed:N, commit}.`,
            { label: `fix:${s.struct}`, phase: "Fix", schema: FIX_S },
          )
        : vr,
  );

  for (const s of survey.structs) done_structs.add(s.struct);
  const removed = survey.structs.reduce((n, s) => n + (s.deref_count || 0), 0);
  history.push({ round, structs: survey.structs.length, derefs_targeted: removed });
}

return { rounds: MAX_ROUNDS, done: false, history };
