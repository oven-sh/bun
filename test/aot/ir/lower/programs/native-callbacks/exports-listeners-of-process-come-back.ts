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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="total"
// CHECK-NEXT: v3 = TypeTest v0 testedType=number
// CHECK-NEXT: Branch v3 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v4):
// CHECK-NEXT: v5 = Integer integer=1
// CHECK-NEXT: Jump -> next b5(v5)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: v7 = NarrowByTest v0, v6
// CHECK-NEXT: v8 = TypeTest v7 testedType=string
// CHECK-NEXT: Branch v8 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v9):
// CHECK-NEXT: v10 = Integer integer=100
// CHECK-NEXT: Jump -> next b5(v10)
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: v12 = Integer integer=10000
// CHECK-NEXT: Jump -> next b5(v12)
// CHECK-NEXT: b5(v13):
// CHECK-NEXT: v14 = Add v2, v13
// CHECK-NEXT: v15 = Convert v14 declared={type=number}
// CHECK-NEXT: v16 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v17 = CheckInitialized v16 name="total"
// CHECK-NEXT: PutModuleVariable v15 variable=[[g_1]]
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: Return v19
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="onCustom"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="total"
// CHECK-NEXT: v3 = TypeTest v0 testedType=number
// CHECK-NEXT: Branch v3 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v4):
// CHECK-NEXT: v5 = Integer integer=100000000
// CHECK-NEXT: Jump -> next b3(v5)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: v7 = Integer integer=200000000
// CHECK-NEXT: Jump -> next b3(v7)
// CHECK-NEXT: b3(v8):
// CHECK-NEXT: v9 = Add v2, v8
// CHECK-NEXT: v10 = Convert v9 declared={type=number}
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="total"
// CHECK-NEXT: PutModuleVariable v10 variable=[[g_1]]
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
