// RUN: lower
// OPTIONS: builtin-modules

// The replacer and the reviver of JSON change from nothing to a function to a list, and toJSON adds a member with its own toJSON.
function main() {
  let replacer = null;
  const data = { a: 1, b: { c: 2 } };
  const seen = [];
  function pick(key, value) { seen.push(typeof this, key); replacer = ["a"]; return value; }
  const out = [];
  for (let i = 0; i < 3; i++) { out.push(JSON.stringify(data, replacer)); if (!i) replacer = pick; }
  console.log(out.join(" "), seen.join());
  let reviver = undefined;
  function revive(key, value) { return typeof value === "number" ? { n: value } : value; }
  const parsed = [];
  for (let i = 0; i < 2; i++) { parsed.push(JSON.parse('{"x":1}', reviver)); reviver = revive; }
  console.log(typeof parsed[0].x, typeof parsed[1].x, parsed[1].x.n);
  const withToJSON = { toJSON() { withToJSON.extra = { toJSON() { return "inner"; } }; return { extra: withToJSON.extra }; } };
  console.log(JSON.stringify(withToJSON), JSON.stringify(withToJSON));
}
main();

// GENERATED: pick revive toJSON
// CHECK-LABEL: function {{*}}name="pick"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasExplicitName] length=2 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything, v2: anything, v3: anything):
// CHECK-NEXT: v4 = GetEnvironmentField v0 layout=[[L_1]] field=1
// CHECK-NEXT: v5 = CheckInitialized v4 name="seen"
// CHECK-NEXT: v6 = PropGet v5 key="push"
// CHECK-NEXT: v7 = TypeOf v1
// CHECK-NEXT: v8 = Call v6, v5, v7, v2 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: v9 = GetEnvironmentField v0 layout=[[L_1]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="replacer"
// CHECK-NEXT: v11 = Data data=[[d_3]]
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[f_2]]|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v0, v12 layout=[[L_1]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="revive"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = TypeTest v1 testedType=number
// CHECK-NEXT: Branch v2 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v3):
// CHECK-NEXT: v4 = NarrowByTest v1, v3
// CHECK-NEXT: v5 = NewObject -, v4 layout=[[L_5]] fields=[0]
// CHECK-NEXT: v6 = FinishObject v5
// CHECK-NEXT: Jump -> next b3(v6)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: v8 = NarrowByTest v1, v7
// CHECK-NEXT: Jump -> next b3(v8)
// CHECK-NEXT: b3(v9):
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="toJSON"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_1]]):
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_1]] field=2
// CHECK-NEXT: v2 = CheckInitialized v1 name="withToJSON"
// CHECK-NEXT: v3 = NewClosure function=[[f_6]]
// CHECK-NEXT: v4 = NewObject -, v3 layout=[[L_7]] fields=[0]
// CHECK-NEXT: v5 = FinishObject v4
// CHECK-NEXT: PropSet v2, v5 key="extra"
// CHECK-NEXT: v7 = GetEnvironmentField v0 layout=[[L_1]] field=2
// CHECK-NEXT: v8 = CheckInitialized v7 name="withToJSON"
// CHECK-NEXT: v9 = PropGet v8 key="extra"
// CHECK-NEXT: v10 = NewObject -, v9 layout=[[L_8]] fields=[0]
// CHECK-NEXT: v11 = FinishObject v10
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="toJSON"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = String string="inner"
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
