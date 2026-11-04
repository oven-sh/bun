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
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=number}, {type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: number, v1: undefined|null|string):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="seen"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = String string="first "
// CHECK-NEXT: v6 = Add v5, v1
// CHECK-NEXT: v7 = Call v4, v3, v6 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: v8 = Convert v7 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v9 = String string="TickObject"
// CHECK-NEXT: v10 = StrictEq v1, v9
// CHECK-NEXT: Branch v10 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="thrown"
// CHECK-NEXT: Throw v12
// CHECK-NEXT: b2():
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="init"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=number}, {type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: number, v1: undefined|null|string):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="seen"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = String string="second "
// CHECK-NEXT: v6 = Add v5, v1
// CHECK-NEXT: v7 = Call v4, v3, v6 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: v8 = Convert v7 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
