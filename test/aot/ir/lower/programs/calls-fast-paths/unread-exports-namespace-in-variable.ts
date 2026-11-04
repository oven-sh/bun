// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 7

// FILE: main.ts
// The namespace object of a module is kept in a module variable to which nothing else is stored, and all that is ever done with what the variable holds is to read members by constant names. An export that nobody calls, names or reads is not in the program.
import { callHook as call0 } from "./aConstant.ts";
import { callHook as call1 } from "./setLater.ts";
import { callHook as call2 } from "./copiedToAnother.ts";
import { callHook as call3 } from "./importedAndKept.ts";
import { callHook as call4 } from "./readInAnotherModule.ts";
import { keptForOthers } from "./keeper.ts";
const lines: string[] = [];
function say(label: string, ...values: unknown[]): void { lines.push(label + ": " + values.map(String).join(" | ")); }
const aConstant = require("./aConstant.ts") as typeof import("./aConstant.ts");
function readsTheConstant(): number { return aConstant.unrelated(); }
let setLater: typeof import("./setLater.ts") | undefined;
function load(): void { setLater = require("./setLater.ts"); }
function readsWhatWasSetLater(): number { return setLater ? setLater.unrelated() : -1; }
const first = require("./copiedToAnother.ts") as typeof import("./copiedToAnother.ts");
const second = first;
function readsTheCopy(): number { const { unrelated } = second; return unrelated(); }
let imported: typeof import("./importedAndKept.ts") | undefined;
async function all(): Promise<void> {
    say("aConstant", readsTheConstant(), call0());
    say("setLater, before", readsWhatWasSetLater()); load(); say("setLater", readsWhatWasSetLater(), call1());
    say("copiedToAnother", readsTheCopy(), first === second, call2());
    imported = await import("./importedAndKept.ts"); say("importedAndKept", imported.unrelated(), call3());
    say("readInAnotherModule", keptForOthers.unrelated(), call4());
}
all().then(() => console.log(lines.join("\n")), error => console.log(lines.join("\n") + "\nfailed: " + error));

// FILE: aConstant.ts
let hookOfAConstant: () => number = () => 0;
export function setHook(fn: () => number): void { hookOfAConstant = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hookOfAConstant(); return t; }
export function unrelated(): number { return 0; }

// FILE: copiedToAnother.ts
let hookOfCopiedToAnother: () => number = () => 0;
export function setHook(fn: () => number): void { hookOfCopiedToAnother = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hookOfCopiedToAnother(); return t; }
export function unrelated(): number { return 2; }

// FILE: importedAndKept.ts
let hookOfImportedAndKept: () => number = () => 0;
export function setHook(fn: () => number): void { hookOfImportedAndKept = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hookOfImportedAndKept(); return t; }
export function unrelated(): number { return 3; }

// FILE: keeper.ts
export const keptForOthers = require("./readInAnotherModule.ts") as typeof import("./readInAnotherModule.ts");

// FILE: readInAnotherModule.ts
let hookOfReadInAnotherModule: () => number = () => 0;
export function setHook(fn: () => number): void { hookOfReadInAnotherModule = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hookOfReadInAnotherModule(); return t; }
export function unrelated(): number { return 4; }

// FILE: setLater.ts
let hookOfSetLater: () => number = () => 0;
export function setHook(fn: () => number): void { hookOfSetLater = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hookOfSetLater(); return t; }
export function unrelated(): number { return 1; }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: say load readsWhatWasSetLater readsTheCopy
// CHECK-LABEL: function {{*}}name="say"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=Array flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: Array):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="lines"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = String string=": "
// CHECK-NEXT: v6 = Add v0, v5
// CHECK-NEXT: v7 = PropGet v1 key="map"
// CHECK-NEXT: v8 = Builtin builtin=String
// CHECK-NEXT: v9 = Call v7, v1, v8 calleeKey="map" calleeName="values.map"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v11 = PropGet v10 key="join"
// CHECK-NEXT: v12 = String string=" | "
// CHECK-NEXT: v13 = Call v11, v10, v12 calleeKey="join" calleeName="join"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v15 = Add v6, v14
// CHECK-NEXT: v16 = Call v4, v3, v15 calleeKey="push" calleeName="lines.push"
// CHECK-NEXT: v17 = Convert v16 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="load"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="setLater"
// CHECK-NEXT: RecordRequire module=[[m_3]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_3]] referrer=[[m_0]]
// CHECK-NEXT: v5 = ModuleNamespace module=[[m_3]]
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|object flags=[OmitsNull]}
// CHECK-NEXT: PutModuleVariable v6 variable=[[g_2]]
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="readsWhatWasSetLater"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="setLater"
// CHECK-NEXT: v2 = ToBoolean v1
// CHECK-NEXT: Branch v2 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v3):
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="setLater"
// CHECK-NEXT: v6 = PropGet v5 key="unrelated"
// CHECK-NEXT: v7 = Call v6, v5 calleeKey="unrelated" calleeName="setLater.unrelated"
// CHECK-NEXT: ReturnCall v7 casts=[{declared={type=number}}]
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = Integer integer=-1
// CHECK-NEXT: v10 = Convert v9 declared={type=number}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="readsTheCopy"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="second"
// CHECK-NEXT: v2 = TypeTest v1 testedType=undefined|null
// CHECK-NEXT: Branch v2 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v3):
// CHECK-NEXT: v4 = NewRuntimeError runtimeError=NotDestructurable name="unrelated"
// CHECK-NEXT: Throw v4
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: v6 = PropGet v5 key="unrelated"
// CHECK-NEXT: v7 = Call v6 calleeName="unrelated"
// CHECK-NEXT: ReturnCall v7 casts=[{declared={type=number}}]
// CHECK-NEXT: }
