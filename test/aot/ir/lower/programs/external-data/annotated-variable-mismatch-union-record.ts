// RUN: lower
// OPTIONS: builtin-modules

// An object that comes through `any` into a variable annotated with a union of a record and something else, and does not fit the record, stays as it is where the union is narrowed to the record too.
// As plain Bun, line by line, for an object that lacks a member and for one that fits.
interface Nested { cwd: string }
interface Wanted { id: string; ctx: Nested }
interface Other { name: string; ctx: Nested }
const parse = (text: string): any => JSON.parse(text);
const kept: Wanted = { id: "k", ctx: { cwd: "/" } };
const other: Other = { name: "o", ctx: { cwd: "/" } };
function idOf(wanted: Wanted): string { return wanted.id; }
const cases: [string, (text: string) => unknown][] = [
  ["| undefined, truthy", text => { const d: Wanted | undefined = parse(text); if (d) return d.id; return 0; }],
  ["| undefined, !== undefined", text => { const d: Wanted | undefined = parse(text); if (d !== undefined) return d.id; return 0; }],
  ["| null, != null", text => { const d: Wanted | null = parse(text); if (d != null) return d.id; return 0; }],
  ["| undefined, ?.", text => { const d: Wanted | undefined = parse(text); return d?.id; }],
  ["| string, typeof !== string", text => { const d: Wanted | string = parse(text); if (typeof d !== "string") return d.id; return 0; }],
  ["| string, typeof === object", text => { const d: Wanted | string = parse(text); if (typeof d === "object") return d.id; return 0; }],
  ["| string, else", text => { const d: Wanted | string = parse(text); if (typeof d === "string") return 0; else return d.id; }],
  ["| string, ternary", text => { const d: Wanted | string = parse(text); return typeof d === "string" ? 0 : d.id; }],
  ["| string, early return", text => { const d: Wanted | string = parse(text); if (typeof d === "string") return 0; return d.id; }],
  ["| string, switch", text => { const d: Wanted | string = parse(text); switch (typeof d) { case "string": return 0; default: return d.id; } }],
  ["| string, &&", text => { const d: Wanted | string = parse(text); return typeof d !== "string" && d.id; }],
  ["| string, handed on", text => { const d: Wanted | string = parse(text); if (typeof d === "string") return 0; const e: Wanted = d; return e.id; }],
  ["| string, assigned on", text => { const d: Wanted | string = parse(text); let e: Wanted = kept; if (typeof d !== "string") e = d; return e.id; }],
  ["| string, passed", text => { const d: Wanted | string = parse(text); if (typeof d === "string") return 0; return idOf(d); }],
  ["| string, returned", text => { const give = (): Wanted | number => { const d: Wanted | string = parse(text); if (typeof d === "string") return 0; return d; }; const got = give(); return typeof got === "number" ? got : got.id; }],
  ["| string, in a literal", text => { const d: Wanted | string = parse(text); if (typeof d === "string") return 0; const o: { r: Wanted } = { r: d }; return o.r.id; }],
  ["| string, the same object", text => { const from = parse(text); const d: Wanted | string = from; if (typeof d === "string") return 0; const e: Wanted = d; const back: any = e; return text.length < 12 ? back === from : back.id === from.id; }],
  ["| string, in a closure", text => { const d: Wanted | string = parse(text); return (() => (typeof d === "string" ? 0 : d.id))(); }],
  ["| string, in a loop", text => { let said = ""; for (let i = 0; i < 3; i++) { const d: Wanted | string = i === 1 ? "s" : parse(text); said += typeof d === "string" ? d : d.id; } return said; }],
  ["| string, assigned later", text => { let d: Wanted | string = "s"; d = parse(text); if (typeof d === "string") return 0; return d.id; }],
  ["| string, the missing member", text => { const d: Wanted | string = parse(text); if (typeof d === "string") return 0; return typeof d.ctx; }],
  ["| string, a store", text => { const from = parse(text); const d: Wanted | string = from; if (typeof d === "string") return 0; d.id = "stored"; return d.id + " " + from.id; }],
  ["| string, it is the string", _ => { const d: Wanted | string = parse('"text"'); if (typeof d === "string") return d; return d.id; }],
  ["| number", text => { const d: Wanted | number = parse(text); if (typeof d !== "number") return d.id; return 0; }],
  ["| boolean", text => { const d: Wanted | boolean = parse(text); if (typeof d !== "boolean") return d.id; return 0; }],
  ["| string | number", text => { const d: Wanted | string | number = parse(text); if (typeof d === "object") return d.id; return 0; }],
  ["| string[]", text => { const d: Wanted | string[] = parse(text); if (!Array.isArray(d)) return d.id; return 0; }],
  ["| string[], it is the array", _ => { const d: Wanted | string[] = parse('["a"]'); if (Array.isArray(d)) return d.length; return d.id; }],
  ["| function", text => { const d: Wanted | (() => void) = parse(text); if (typeof d !== "function") return d.id; return 0; }],
  ["| Date", text => { const d: Wanted | Date = parse(text); if (!(d instanceof Date)) return d.id; return 0; }],
  ["| Map", text => { const d: Wanted | Map<string, string> = parse(text); if (d instanceof Map) return 0; return d.id; }],
  ["| Other, in", text => { const d: Wanted | Other = parse(text); if ("id" in d) return d.id; return 0; }],
  ["| Other, not in", text => { const d: Wanted | Other = parse(text); if (!("name" in d)) return d.id; return 0; }],
  ["| Other, it is one made here", _ => { const d: Wanted | Other = parse("0") || other; if ("name" in d) return d.name; return d.id; }],
  ["| string, it is one made here", _ => { const d: Wanted | string = parse("0") || kept; if (typeof d === "string") return 0; return d.id + d.ctx.cwd; }],
];
for (const text of ['{"id":"y"}', '{"id":"z","ctx":{"cwd":"/"}}']) {
  for (const [name, run] of cases) {
    let said: string;
    try { said = String(run(text)); } catch (error) { said = "threw " + (error as Error).constructor.name; }
    console.log(name + ": " + said);
  }
}

// GENERATED: idOf parse give
// CHECK-LABEL: function {{*}}name="idOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="id"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="parse"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=JSON
// CHECK-NEXT: v2 = PropGet v1 key="parse"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(JSONParse) flags=[IsExpected]}
// CHECK-NEXT: v4 = Call v3, v1, v0 calleeKey="parse" calleeName="JSON.parse"
// CHECK-NEXT: ReturnCall v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="give"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] captures=[{type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] thisType={type=anything} results=[{type=undefined|null|number|[[L_1]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="parse"
// CHECK-NEXT: v3 = Call v2, -, v0 calleeName="parse"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string|[[L_1]] site=[[w_10]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = TypeTest v5 testedType=string
// CHECK-NEXT: Branch v6 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v8 = Integer
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|number|[[L_1]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: b4(v10):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[L_1]]} illTypedCause=Assertion
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|number|[[L_1]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
