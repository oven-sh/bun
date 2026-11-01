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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|"bigint"|"boolean"|"function"|"global"|"null"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="globalThis" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: v4 = StrictEq v0, v3
// CHECK-NEXT: Branch v4 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v6 = String string="global"
// CHECK-NEXT: Jump -> next b14(v6)
// CHECK-NEXT: b4(v7):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v8 = TypeTest v7 testedType=undefined
// CHECK-NEXT: Branch v8 -> taken b6(| 0), notTaken b8(| 0)
// CHECK-NEXT: b6(v9):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v10 = String string="undefined"
// CHECK-NEXT: Jump -> next b14(v10)
// CHECK-NEXT: b8(v11):
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v12 = TypeTest v11 testedType=null
// CHECK-NEXT: Branch v12 -> taken b10(| 0), notTaken b12(| 0)
// CHECK-NEXT: b10(v13):
// CHECK-NEXT: Jump -> next b11()
// CHECK-NEXT: b11():
// CHECK-NEXT: v14 = String string="null"
// CHECK-NEXT: Jump -> next b14(v14)
// CHECK-NEXT: b12(v15):
// CHECK-NEXT: Jump -> next b13()
// CHECK-NEXT: b13():
// CHECK-NEXT: v16 = TypeOf v15
// CHECK-NEXT: Jump -> next b14(v16)
// CHECK-NEXT: b14(v17):
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|"bigint"|"boolean"|"function"|"global"|"null"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="flush"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = String string=": "
// CHECK-NEXT: v7 = Add v0, v6
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="seen"
// CHECK-NEXT: v10 = PropGet v9 key="join"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v12 = String string=" "
// CHECK-NEXT: v13 = Call v11, v9, v12 calleeKey="join" calleeName="seen.join"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v15 = Add v7, v14
// CHECK-NEXT: v16 = Call v5, v3, v15 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v18 = CheckInitialized v17 name="seen"
// CHECK-NEXT: v19 = Integer
// CHECK-NEXT: v20 = Convert v19 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v18, v20 key="length"
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_7]] flags=[IsExpected]}
// CHECK-NEXT: v4 = String string="set"
// CHECK-NEXT: v5 = Call v3, -, v4, v0 calleeName="note"
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
