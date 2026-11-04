// RUN: lower
// OPTIONS: builtin-modules

// What TypeScript refuses in a literal and JavaScript allows: a name twice, an accessor under a name that is also defined, in either order, with values of one type and of several.
const lines = [];
const keysOf = object => Reflect.ownKeys(object).map(String).join();
function accessorFirst(i) { return { a: i, get d() { return "getter"; }, d: i + 1, e: "e" }; }
function accessorLast(i) { return { a: i, d: i + 1, get d() { return "getter " + this.a; }, e: "e" }; }
function setterFirst(i) { return { a: i, set d(value) { lines.push("the setter ran"); }, d: i + 1, e: "e" }; }
function setterLast(i) { return { a: i, d: i + 1, set d(value) { lines.push("the setter ran"); }, e: "e" }; }
function twice(i) { return { a: i, d: "first", e: "e", d: i + 1 }; }
function twiceWithCallsBetween(i) { return { a: i, d: String(i), e: [i].join(), d: i + 1, f: [i, i].join() }; }
function thrice(i) { return { d: 1, d: "two", d: { three: i } }; }
function prototypeTwiceInWords(i) { return { __proto__: null, ["__proto__"]: i, a: i, d: i + 1 }; }
function methodsAndNames(i) { return { run() { return this.d; }, d: i + 1, run2: () => i, e: "e", run() { return "second " + this.d; } }; }
for (const [label, make] of Object.entries({ accessorFirst, accessorLast, setterFirst, setterLast, twice, twiceWithCallsBetween, thrice, prototypeTwiceInWords, methodsAndNames })) {
  let last;
  for (let i = 0; i < 40; i++) last = make(i);
  lines.push(label + ": " + keysOf(last) + " | " + JSON.stringify(last.d) + " | " + JSON.stringify(Object.getOwnPropertyDescriptor(last, "d"), (key, value) => typeof value === "function" ? "function" : value) + " | " + (typeof last.run === "function" ? last.run() : "no run") + " | " + String(Object.getPrototypeOf(last) === Object.prototype));
}
console.log(lines.join("\n"));

// GENERATED: accessorLast setterLast prototypeTwiceInWords keysOf run
// CHECK-LABEL: function {{*}}name="accessorLast"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: v2 = Add v0, v1
// CHECK-NEXT: v3 = NewObject -, v0, v2 layout=[[L_1]] fields=[0, 1]
// CHECK-NEXT: v4 = NewClosure function=[[f_2]]
// CHECK-NEXT: DefineGetter v3, v4 key="d"
// CHECK-NEXT: v6 = String string="e"
// CHECK-NEXT: PropDefine v3, v6 key="e"
// CHECK-NEXT: v8 = FinishObject v3
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="setterLast"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: v2 = Add v0, v1
// CHECK-NEXT: v3 = NewObject -, v0, v2 layout=[[L_3]] fields=[0, 1]
// CHECK-NEXT: v4 = NewClosure function=[[f_4]]
// CHECK-NEXT: DefineSetter v3, v4 key="d"
// CHECK-NEXT: v6 = String string="e"
// CHECK-NEXT: PropDefine v3, v6 key="e"
// CHECK-NEXT: v8 = FinishObject v3
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="prototypeTwiceInWords"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Null
// CHECK-NEXT: v2 = NewObject layout=[[L_5]]
// CHECK-NEXT: SetLiteralPrototype v2, v1
// CHECK-NEXT: PropDefine v2, v0 key="__proto__"
// CHECK-NEXT: PropDefine v2, v0 key="a"
// CHECK-NEXT: v6 = Integer integer=1
// CHECK-NEXT: v7 = Add v0, v6
// CHECK-NEXT: PropDefine v2, v7 key="d"
// CHECK-NEXT: v9 = FinishObject v2
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="keysOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: v1 = Builtin builtin=Reflect
// CHECK-NEXT: v2 = Builtin builtin=ReflectOwnKeys
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Reflect.ownKeys"
// CHECK-NEXT: v4 = PropGet v3 key="map"
// CHECK-NEXT: v5 = Builtin builtin=String
// CHECK-NEXT: v6 = Call v4, v3, v5 calleeKey="map" calleeName="map"
// CHECK-NEXT: v7 = PropGet v6 key="join"
// CHECK-NEXT: v8 = Call v7, v6 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="run"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = PropGet v0 key="d"
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="run"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = String string="second "
// CHECK-NEXT: v2 = PropGet v0 key="d"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
