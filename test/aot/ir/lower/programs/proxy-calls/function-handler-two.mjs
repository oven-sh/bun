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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] length=1 syntax=[HasWrittenAwait] thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|number|string|symbol|bigint|[[L_1]]):
// CHECK-NEXT: v2 = ToBoolean v1
// CHECK-NEXT: Branch v2 -> taken b1(| 0), notTaken b3()
// CHECK-NEXT: b1(v3):
// CHECK-NEXT: v4 = PropGet v1 key="next"
// CHECK-NEXT: v5 = TypeTest v4 testedType=function
// CHECK-NEXT: Branch v5 -> taken b2(| 0), notTaken b3()
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: v7 = String string="yields "
// CHECK-NEXT: v8 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v8, v1
// CHECK-NEXT: v10 = PropGet v8 key="join"
// CHECK-NEXT: v11 = Call v10, v8 calleeKey="join" calleeName="join"
// CHECK-NEXT: v12 = Add v7, v11
// CHECK-NEXT: Return v12
// CHECK-NEXT: b3():
// CHECK-NEXT: v13 = ToBoolean v1
// CHECK-NEXT: Branch v13 -> taken b4(| 0), notTaken b6(v1)
// CHECK-NEXT: b4(v14):
// CHECK-NEXT: v15 = PropGet v1 key="then"
// CHECK-NEXT: v16 = TypeTest v15 testedType=function
// CHECK-NEXT: Branch v16 -> taken b5(| 0), notTaken b6(v1)
// CHECK-NEXT: b5(v17):
// CHECK-NEXT: v18 = String string="resolves "
// CHECK-NEXT: v19 = Await v1, v1
// CHECK-NEXT: v20 = Add v18, v19
// CHECK-NEXT: Jump -> next b6(v20)
// CHECK-NEXT: b6(v21):
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="target"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasArgumentCount, HasHiddenRest, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: int[0, 4294967295], v2: anything, v3: anything, v4: Array):
// CHECK-NEXT: v5 = CreateUnmappedArguments v1, v4, v2, v3
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v7 = Call v6, -, v0 calleeName="show"
// CHECK-NEXT: v8 = PropGet v5 key="length"
// CHECK-NEXT: v9 = NewArray v7, v2, v3, v8 contents=anything
// CHECK-NEXT: v10 = PropGet v9 key="join"
// CHECK-NEXT: v11 = Call v10, v9 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v11
// CHECK-NEXT: }
