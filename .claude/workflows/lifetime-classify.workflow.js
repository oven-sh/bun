export const meta = {
  name: "lifetime-classify",
  description: "Classify every *T/?*T struct field in a set of .zig files into a Rust ownership type",
  phases: [
    { title: "Classify", detail: "one agent per file: read struct+init+deinit, classify each pointer field" },
    { title: "Verify", detail: "3-vote refute on UNKNOWN + 20% sample of confident classifications" },
    { title: "Synthesize", detail: "emit LIFETIMES.tsv rows + taxonomy stats" },
  ],
};

const REPO = "/root/bun-5";
const FILES = (args && args.files) || []; // [{zig, crate}]
if (FILES.length === 0) return { error: "no files" };

const TAXONOMY = `
OWNED        → Box<T> / Option<Box<T>>      — this struct creates it (bun.new/allocator.create) AND deinit destroys it
SHARED       → Rc<T> / Arc<T>               — ref-counted; multiple owners; deinit calls .deref()/.release()
BORROW_PARAM → struct gets <'a>, &'a T      — assigned from a constructor/init param; outlives self because caller guarantees it
BORROW_FIELD → &'a T tied to sibling field  — points into self.other_field's allocation (e.g. slice into self.buffer)
STATIC       → &'static T                   — assigned from a global/static/singleton (VirtualMachine.get(), bun.http.* globals)
JSC_BORROW   → &JSGlobalObject / &VM etc.   — well-known JSC types always borrowed from caller; no struct lifetime needed (passed per-call)
BACKREF      → *const Parent (raw)          — points to the struct that OWNS self; would need Weak<> or index restructure; raw ptr for now
INTRUSIVE    → *mut T (raw)                 — next/prev/link in intrusive list; @fieldParentPtr recovers container
FFI          → *mut T / *const T (raw)      — comes from or goes to C; *_sys crate or extern fn
ARENA        → StoreRef<T> / *const T       — points into arena/Store; freed by arena.reset() not per-field
UNKNOWN      → Option<NonNull<T>> + TODO    — can't determine from this file alone
`.trim();

const CLASSIFY_SCHEMA = {
  type: "object",
  required: ["fields"],
  properties: {
    fields: {
      type: "array",
      items: {
        type: "object",
        required: ["struct", "field", "zig_type", "class", "rust_type", "evidence"],
        properties: {
          struct: { type: "string" },
          field: { type: "string" },
          zig_type: { type: "string", description: "e.g. ?*Foo, *const Bar" },
          class: {
            enum: [
              "OWNED",
              "SHARED",
              "BORROW_PARAM",
              "BORROW_FIELD",
              "STATIC",
              "JSC_BORROW",
              "BACKREF",
              "INTRUSIVE",
              "FFI",
              "ARENA",
              "UNKNOWN",
            ],
          },
          rust_type: { type: "string", description: "exact Rust type, e.g. Option<Box<Foo>>, &'a Bar" },
          evidence: {
            type: "string",
            description: "file:line of the init/deinit/assignment that proves it (≤100 chars)",
          },
          confidence: { enum: ["high", "low"] },
        },
      },
    },
  },
};

const VERDICT = {
  type: "object",
  required: ["refuted", "correct_class"],
  properties: {
    refuted: { type: "boolean" },
    correct_class: { type: "string", description: "if refuted, what the class should be; else echo original" },
    reason: { type: "string" },
  },
};

phase("Classify");
const classified = await pipeline(FILES, f =>
  agent(
    `Classify every pointer struct field (*T, ?*T, *const T, [*]T) in this Zig file into a Rust ownership category.

Read ${REPO}/${f.zig}. You may grep ${REPO}/src/${f.crate}/ for callers/assignments (same-crate only — do NOT read other crates).

Taxonomy:
${TAXONOMY}

For each pointer field:
1. Find where it's assigned (init/new/constructor, or direct field write).
2. Find what deinit does with it (destroy/deref/nothing).
3. Pick the class. Cite evidence as "file:line — <what you saw>".
4. Propose the exact Rust type.

Heuristics:
- *JSGlobalObject, *VirtualMachine, *CallFrame, *VM → JSC_BORROW (these are NEVER stored long-term; if stored on a struct it means the struct is per-call scope)
- field named next/prev/head/tail/link AND points to same-or-container type → INTRUSIVE
- assigned from @fieldParentPtr or container_of → BACKREF
- ${f.crate.endsWith("_sys") ? "this is a *_sys crate → default FFI" : "this is NOT a *_sys crate"}
- if deinit calls bun.destroy(self.field) or self.field.?.deinit()+free → OWNED
- if NO deinit touches it AND assigned from param → BORROW_PARAM
- can't tell → UNKNOWN with confidence=low

Return ONLY fields that are pointer types. Skip [*]const u8 / []u8 (slices, handled separately).`,
    { label: `classify:${f.zig.replace(/^src\//, "")}`, phase: "Classify", schema: CLASSIFY_SCHEMA },
  ).then(r => (r ? r.fields.map(x => ({ ...x, file: f.zig, crate: f.crate })) : [])),
);
const all = classified.flat();
log(`classify: ${all.length} fields across ${FILES.length} files`);

phase("Verify");
// verify all UNKNOWN/low + 12% sample of high-confidence (cap to stay <1000 agents at scale)
let toVerify = all.filter(f => f.class === "UNKNOWN" || f.confidence === "low" || Math.random() < 0.12);
if (FILES.length + toVerify.length * 3 > 980) toVerify = toVerify.slice(0, Math.floor((980 - FILES.length) / 3));
log(`verify: ${toVerify.length}/${all.length} selected`);
const verified = await parallel(
  toVerify.map((f, i) => async () => {
    const votes = await parallel(
      Array.from(
        { length: 3 },
        (_, j) => () =>
          agent(
            `Adversarially verify a lifetime classification. Default refuted=true if uncertain.

File: ${REPO}/${f.file} (crate: ${f.crate})
Struct: ${f.struct}
Field: ${f.field}: ${f.zig_type}
Claimed class: ${f.class} → ${f.rust_type}
Evidence cited: ${f.evidence}

Taxonomy:
${TAXONOMY}

Read the file. Check the evidence. Refute if: (a) the evidence line doesn't say what's claimed, (b) a different class fits better, (c) the rust_type is wrong for the class. If refuted, give correct_class.`,
            { label: `verify:${i}.${j}`, phase: "Verify", schema: VERDICT },
          ),
      ),
    );
    const refutes = votes.filter(v => v && v.refuted).length;
    const consensus = refutes >= 2 ? votes.find(v => v && v.refuted)?.correct_class : f.class;
    return { ...f, refutes, final_class: consensus, verified: true };
  }),
);
// merge verified back into all
const vmap = new Map(verified.map(v => [`${v.file}|${v.struct}|${v.field}`, v]));
const final = all.map(
  f => vmap.get(`${f.file}|${f.struct}|${f.field}`) || { ...f, final_class: f.class, verified: false },
);

phase("Synthesize");
const byClass = {};
for (const f of final) byClass[f.final_class] = (byClass[f.final_class] || 0) + 1;
const tsv = final
  .map(f => [f.file, f.struct, f.field, f.zig_type, f.final_class, f.rust_type, f.evidence].join("\t"))
  .join("\n");

return {
  total_fields: final.length,
  by_class: byClass,
  unknown_rate: ((byClass.UNKNOWN || 0) / final.length).toFixed(3),
  verified_count: verified.length,
  overturned: verified.filter(v => v.refutes >= 2).length,
  tsv_preview: tsv.split("\n").slice(0, 20).join("\n"),
  tsv,
};
