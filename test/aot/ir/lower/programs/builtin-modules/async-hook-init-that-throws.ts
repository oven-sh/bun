// RUN: lower
// OPTIONS: builtin-modules

// An `init` hook of node:async_hooks that throws at process.nextTick(): what it threw is printed, the process is asked to exit with 1, and where exit() returns the tick is queued all the same.
import { createHook } from "node:async_hooks";

const asked: unknown[] = [];
const exit = process.exit;
process.exit = ((code?: number) => void asked.push(code)) as typeof process.exit;
let thrown: unknown = { stack: "a stack that is text" };
const seen: string[] = [];
const first = createHook({ init(_id, type) { seen.push("first " + type); if (type === "TickObject") throw thrown; } }).enable();
const second = createHook({ init(_id, type) { seen.push("second " + type); } }).enable();
process.nextTick(() => console.log("the first tick ran"));
thrown = { no: "stack" };
process.nextTick((...all: unknown[]) => console.log("the second tick ran with", ...all), 1, 2);
first.disable();
process.nextTick(() => {
  second.disable();
  process.exit = exit;
  console.log("asked to exit with", asked, seen);
});

// GENERATED: init
// CHECK-LABEL: function {{*}}name="init"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=number site=[[w_1]]}, {type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: number, v1: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="seen"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = String string="first "
// CHECK-NEXT: v6 = Add v5, v1
// CHECK-NEXT: v7 = Call v4, v3, v6 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: v8 = Convert v7 declared={type=number site=[[w_5]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v9 = String string="TickObject"
// CHECK-NEXT: v10 = StrictEq v1, v9
// CHECK-NEXT: Branch v10 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v11):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="thrown"
// CHECK-NEXT: Throw v13
// CHECK-NEXT: b4(v14):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="init"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=number site=[[w_7]]}, {type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: number, v1: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="seen"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = String string="second "
// CHECK-NEXT: v6 = Add v5, v1
// CHECK-NEXT: v7 = Call v4, v3, v6 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: v8 = Convert v7 declared={type=number site=[[w_10]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
