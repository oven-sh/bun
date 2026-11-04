// RUN: lower
// OPTIONS: builtin-modules

// Code made from text at run time reads and stores a global that is an accessor, and a getter made from text is found by a free name. Strict code.
const seen = [];
function describe(value) {
  return value === globalThis ? "global" : value === undefined ? "undefined" : value === null ? "null" : typeof value;
}
function note(label, value) {
  seen.push(label + "=" + describe(value));
}
function flush(title) {
  console.log(title + ": " + seen.join(" "));
  seen.length = 0;
}

Object.defineProperty(globalThis, "accessor", {
  configurable: true,
  get: function () {
    return this;
  },
  set: function (value) {
    note("set", this);
  },
});
note("indirect eval", (0, eval)("accessor"));
note("Function", new Function("return accessor")());
note("direct eval", eval("accessor"));
flush("read from text");
(0, eval)("accessor = 1");
new Function("accessor = 1")();
eval("accessor = 1");
flush("stored from text");

Object.defineProperty(globalThis, "getterFromText", { configurable: true, get: new Function("return this") });
note("first", getterFromText);
note("second", getterFromText);
flush("getter made from text");

// GENERATED: describe flush set
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="globalThis" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: v4 = StrictEq v0, v3
// CHECK-NEXT: Branch v4 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v5 = String string="global"
// CHECK-NEXT: Jump -> next b7(v5)
// CHECK-NEXT: b2():
// CHECK-NEXT: v6 = TypeTest v0 testedType=undefined
// CHECK-NEXT: Branch v6 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v7):
// CHECK-NEXT: v8 = String string="undefined"
// CHECK-NEXT: Jump -> next b7(v8)
// CHECK-NEXT: b4(v9):
// CHECK-NEXT: v10 = NarrowByTest v0, v9
// CHECK-NEXT: v11 = TypeTest v10 testedType=null
// CHECK-NEXT: Branch v11 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v12):
// CHECK-NEXT: v13 = String string="null"
// CHECK-NEXT: Jump -> next b7(v13)
// CHECK-NEXT: b6(v14):
// CHECK-NEXT: v15 = NarrowByTest v0, v14
// CHECK-NEXT: v16 = TypeOf v15
// CHECK-NEXT: Jump -> next b7(v16)
// CHECK-NEXT: b7(v17):
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="flush"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = String string=": "
// CHECK-NEXT: v7 = Add v0, v6
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="seen"
// CHECK-NEXT: v10 = PropGet v9 key="join"
// CHECK-NEXT: v11 = String string=" "
// CHECK-NEXT: v12 = Call v10, v9, v11 calleeKey="join" calleeName="seen.join"
// CHECK-NEXT: v13 = Add v7, v12
// CHECK-NEXT: v14 = Call v5, v3, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v16 = CheckInitialized v15 name="seen"
// CHECK-NEXT: v17 = Integer
// CHECK-NEXT: PropSet v16, v17 key="length"
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: Return v19
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v3 = String string="set"
// CHECK-NEXT: v4 = Call v2, -, v3, v0 calleeName="note"
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
