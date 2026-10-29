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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v2 = Integer integer=1
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = NewObject -, v1, v3 layout=[[L_1]] fields=[0, 1]
// CHECK-NEXT: v5 = NewClosure function=[[f_3]]
// CHECK-NEXT: DefineGetter v4, v5 key="d"
// CHECK-NEXT: v7 = String string="e"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: PropDefine v4, v8 key="e"
// CHECK-NEXT: v10 = FinishObject v4
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="setterLast"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|[[L_4]] flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v2 = Integer integer=1
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = NewObject -, v1, v3 layout=[[L_4]] fields=[0, 1]
// CHECK-NEXT: v5 = NewClosure function=[[f_6]]
// CHECK-NEXT: DefineSetter v4, v5 key="d"
// CHECK-NEXT: v7 = String string="e"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: PropDefine v4, v8 key="e"
// CHECK-NEXT: v10 = FinishObject v4
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="prototypeTwiceInWords"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|[[L_7]] flags=[IsExpected]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Null
// CHECK-NEXT: v2 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v3 = NewObject layout=[[L_7]]
// CHECK-NEXT: SetLiteralPrototype v3, v1
// CHECK-NEXT: PropDefine v3, v2 key="__proto__"
// CHECK-NEXT: PropDefine v3, v2 key="a"
// CHECK-NEXT: v7 = Integer integer=1
// CHECK-NEXT: v8 = Add v2, v7
// CHECK-NEXT: PropDefine v3, v8 key="d"
// CHECK-NEXT: v10 = FinishObject v3
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[L_7]] flags=[IsExpected]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="keysOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Reflect
// CHECK-NEXT: v2 = Builtin builtin=ReflectOwnKeys
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Reflect.ownKeys"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|string|symbol> flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="map"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_10]] flags=[IsExpected]}
// CHECK-NEXT: v7 = Builtin builtin=String
// CHECK-NEXT: v8 = Call v6, v4, v7 calleeKey="map" calleeName="map"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v9 key="join"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[f_11]] flags=[IsExpected]}
// CHECK-NEXT: v12 = Call v11, v9 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v12 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="run"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_13]] flags=[IsExpected]}
// CHECK-NEXT: v2 = PropGet v1 key="d"
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="run"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_14]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="second "
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|[[L_13]] flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="d"
// CHECK-NEXT: v4 = Add v1, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
