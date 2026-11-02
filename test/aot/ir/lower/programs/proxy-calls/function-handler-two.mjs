// RUN: lower
// OPTIONS: builtin-modules

// A call of a Proxy answers as in plain Bun: function-handler, two.
const log = [];
function show(v) { return v === undefined ? "undefined" : v === null ? "null" : v === globalThis ? "global" : typeof v === "object" || typeof v === "function" ? "[" + typeof v + (v.name ? " " + v.name : "") + "]" : typeof v + ":" + String(v); }
async function settle(v) { if (v && typeof v.next === "function") return "yields " + [...v].join(); return v && typeof v.then === "function" ? "resolves " + (await v) : v; }
function target(a, b) { return [show(this), a, b, arguments.length].join(); }
const handler = Object.assign(function () {}, { });
const p = new Proxy(target, handler);
try { console.log(String(await settle(p(1, 2)))); } catch (e) { console.log(e.name, e.message); }
console.log(log.join());

// GENERATED: settle target
// CHECK-LABEL: function {{*}}name="settle"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}] results=[{type=undefined|null|Promise flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|number|string|symbol|bigint|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = ToBoolean v1
// CHECK-NEXT: Branch v2 -> taken b2(| 0), notTaken b7(| 0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v4 = PropGet v3 key="next"
// CHECK-NEXT: v5 = TypeTest v4 testedType=function
// CHECK-NEXT: Branch v5 -> taken b4(| 0), notTaken b6(| 0)
// CHECK-NEXT: b4(v6):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v7 = String string="yields "
// CHECK-NEXT: v8 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v8, v3
// CHECK-NEXT: v10 = Convert v8 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v11 = PropGet v10 key="join"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v13 = Call v12, v10 calleeKey="join" calleeName="join"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v15 = Add v7, v14
// CHECK-NEXT: Return v15
// CHECK-NEXT: b6(v16):
// CHECK-NEXT: Jump -> next b8(v3)
// CHECK-NEXT: b7(v17):
// CHECK-NEXT: Jump -> next b8(v17)
// CHECK-NEXT: b8(v18):
// CHECK-NEXT: v19 = ToBoolean v18
// CHECK-NEXT: Branch v19 -> taken b9(| 0), notTaken b14(| 0)
// CHECK-NEXT: b9(v20):
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v21 = PropGet v20 key="then"
// CHECK-NEXT: v22 = TypeTest v21 testedType=function
// CHECK-NEXT: Branch v22 -> taken b11(| 0), notTaken b13(| 0)
// CHECK-NEXT: b11(v23):
// CHECK-NEXT: Jump -> next b12()
// CHECK-NEXT: b12():
// CHECK-NEXT: v24 = String string="resolves "
// CHECK-NEXT: v25 = Await v20, v20
// CHECK-NEXT: v26 = Add v24, v25
// CHECK-NEXT: Jump -> next b16(v26)
// CHECK-NEXT: b13(v27):
// CHECK-NEXT: Jump -> next b15(v20)
// CHECK-NEXT: b14(v28):
// CHECK-NEXT: Jump -> next b15(v28)
// CHECK-NEXT: b15(v29):
// CHECK-NEXT: Jump -> next b16(v29)
// CHECK-NEXT: b16(v30):
// CHECK-NEXT: Return v30
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="target"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasArgumentCount, HasHiddenRest, HasExplicitName] length=2 thisType={type=undefined|null|number|string|symbol|bigint|[[L_3]] flags=[IsExpected]} parameters=[{type=anything}, {type=anything}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_3]], v1: int[0, 4294967295], v2: anything, v3: anything, v4: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v5 = CreateUnmappedArguments v1, v4, v2, v3
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v7 = Call v6, -, v0 calleeName="show"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v5 key="length"
// CHECK-NEXT: v10 = Convert v9 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v11 = NewArray v8, v2, v3, v10 contents=anything
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="join"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v15 = Call v14, v12 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v15 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: }
