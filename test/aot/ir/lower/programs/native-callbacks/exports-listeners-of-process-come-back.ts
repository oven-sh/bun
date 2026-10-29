// RUN: lower
// OPTIONS: builtin-modules

// Exports of start-up modules: the process is an emitter that native code made; listeners, rawListeners and emit hand the program's functions back or call them with what the program passes as `any`.
let total = 0;

function onExit(code: number): void {
  total += typeof code === "number" ? 1 : typeof code === "string" ? 100 : 10000;
}
function onBeforeExit(code: number): void {
  total += typeof code === "number" ? 100000 : typeof code === "string" ? 1000000 : 10000000;
}
function onCustom(value: number): void {
  total += typeof value === "number" ? 100000000 : 200000000;
}

onExit(0);
onBeforeExit(0);
onCustom(0);
process.on("exit", onExit);
process.once("beforeExit", onBeforeExit);
process.on("custom" as any, onCustom);
for (const listener of process.listeners("exit") as any[]) listener("text");
for (const listener of process.rawListeners("beforeExit") as any[]) listener("text");
process.emit("custom" as any, "text" as any);
process.on("exit", () => console.log(total, process.listenerCount("exit"), process.eventNames().length));

// GENERATED: onExit onCustom
// CHECK-LABEL: function {{*}}name="onExit"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_1]]}] results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="total"
// CHECK-NEXT: v3 = TypeTest v0 testedType=number
// CHECK-NEXT: Branch v3 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v5 = Integer integer=1
// CHECK-NEXT: Jump -> next b10(v5)
// CHECK-NEXT: b4(v6):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v7 = TypeTest v6 testedType=string
// CHECK-NEXT: Branch v7 -> taken b6(| 0), notTaken b8(| 0)
// CHECK-NEXT: b6(v8):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v9 = Integer integer=100
// CHECK-NEXT: Jump -> next b10(v9)
// CHECK-NEXT: b8(v10):
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v11 = Integer integer=10000
// CHECK-NEXT: Jump -> next b10(v11)
// CHECK-NEXT: b10(v12):
// CHECK-NEXT: v13 = Add v2, v12
// CHECK-NEXT: v14 = Convert v13 declared={type=number site=[[w_4]]}
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v16 = CheckInitialized v15 name="total"
// CHECK-NEXT: PutModuleVariable v14 variable=[[g_3]]
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="onCustom"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_5]]}] results=[{type=anything}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="total"
// CHECK-NEXT: v3 = TypeTest v0 testedType=number
// CHECK-NEXT: Branch v3 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v5 = Integer integer=100000000
// CHECK-NEXT: Jump -> next b6(v5)
// CHECK-NEXT: b4(v6):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v7 = Integer integer=200000000
// CHECK-NEXT: Jump -> next b6(v7)
// CHECK-NEXT: b6(v8):
// CHECK-NEXT: v9 = Add v2, v8
// CHECK-NEXT: v10 = Convert v9 declared={type=number site=[[w_4]]}
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="total"
// CHECK-NEXT: PutModuleVariable v10 variable=[[g_3]]
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
