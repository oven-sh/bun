// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.ts
// The condition is an imported constant: a const false, a const true, a let that its file changes, a const that is computed, an enum member, and a const read through a namespace. Each arm calls its own function.
import { OFF, ON, changes, change, computed, Level } from "./flags";
import * as flags from "./flags";

const log: string[] = [];
function a1() { log.push("OFF is true"); } function a2() { log.push("OFF is false"); } function b1() { log.push("ON is true"); } function b2() { log.push("ON is false"); }
function c1() { log.push("changes is true"); } function c2() { log.push("changes is false"); } function d1() { log.push("computed is true"); } function d2() { log.push("computed is false"); }
function e1() { log.push("Level.High is true"); } function e2() { log.push("Level.High is false"); } function f1() { log.push("flags.ON is true"); } function f2() { log.push("flags.ON is false"); }

OFF ? a1() : a2();
ON ? b1() : b2();
changes ? c1() : c2();
change();
changes ? c1() : c2();
computed ? d1() : d2();
Level.High ? e1() : e2();
flags.ON ? f1() : f2();
console.log(log.join("\n"));

// FILE: flags.ts
export const OFF = false;
export const ON = true;
export let changes = false;
export function change() { changes = true; }
export const computed = [1].length === 1;
export enum Level { Low, High }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: a1 a2
// CHECK-LABEL: function {{*}}name="a1"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewRuntimeError runtimeError=LeftOutOfExecutable name="a1"
// CHECK-NEXT: Throw v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="a2"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="log"
// CHECK-NEXT: v2 = PropGet v1 key="push"
// CHECK-NEXT: v3 = String string="OFF is false"
// CHECK-NEXT: v4 = Call v2, v1, v3 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_2]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
