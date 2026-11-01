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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = GetEnvironmentField v0 layout=[[L_1]] field=1
// CHECK-NEXT: v5 = CheckInitialized v4 name="seen"
// CHECK-NEXT: v6 = PropGet v5 key="push"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v8 = TypeOf v1
// CHECK-NEXT: v9 = Call v7, v5, v8, v2 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: v10 = GetEnvironmentField v0 layout=[[L_1]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="replacer"
// CHECK-NEXT: v12 = Data data=[[d_4]]
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[f_2]]|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v0, v14 layout=[[L_1]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="revive"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=undefined|null|number|[[L_5]] flags=[IsExpected]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = TypeTest v1 testedType=number
// CHECK-NEXT: Branch v2 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v5 = NewObject layout=[[L_5]]
// CHECK-NEXT: PropDefine v5, v4 key="n"
// CHECK-NEXT: v7 = FinishObject v5
// CHECK-NEXT: Jump -> next b6(v7)
// CHECK-NEXT: b4(v8):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v9 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b6(v9)
// CHECK-NEXT: b6(v10):
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|number|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="toJSON"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=undefined|null|[[L_7]] flags=[IsExpected]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: env [[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_1]] field=2
// CHECK-NEXT: v2 = CheckInitialized v1 name="withToJSON"
// CHECK-NEXT: v3 = NewClosure function=[[f_9]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_10]]|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v5 = NewObject layout=[[L_11]]
// CHECK-NEXT: PropDefine v5, v4 key="toJSON"
// CHECK-NEXT: v7 = FinishObject v5
// CHECK-NEXT: PropSet v2, v7 key="extra"
// CHECK-NEXT: v9 = GetEnvironmentField v0 layout=[[L_1]] field=2
// CHECK-NEXT: v10 = CheckInitialized v9 name="withToJSON"
// CHECK-NEXT: v11 = PropGet v10 key="extra"
// CHECK-NEXT: v12 = NewObject -, v11 layout=[[L_7]] fields=[0]
// CHECK-NEXT: v13 = FinishObject v12
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[L_7]] flags=[IsExpected]}
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="toJSON"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="inner"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
