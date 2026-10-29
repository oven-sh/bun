// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 19

// FILE: main.ts
// A module whose exported setter nobody calls and nobody names, and whose namespace object goes through then, catch or finally and gets away behind them, in one way a file: the setter is found all the same, and what it stores is called.
import { callHook as call0 } from "./handedOnByTheHandler.ts";
import { callHook as call1 } from "./anUnknownHandler.ts";
import { callHook as call2 } from "./aRestParameter.ts";
import { callHook as call3 } from "./theArgumentsObject.ts";
import { callHook as call4 } from "./returnedAndHandedOn.ts";
import { callHook as call5 } from "./thePromiseOfThenIsKept.ts";
import { callHook as call6 } from "./aSecondHandler.ts";
import { callHook as call7 } from "./aWrittenTypeInTheHandler.ts";
import { callHook as call8 } from "./aComputedKeyInTheHandler.ts";
import { callHook as call9 } from "./theListIsHandedOn.ts";
import { callHook as call10 } from "./passedThroughThenWithoutAHandler.ts";
import { callHook as call11 } from "./storedByTheHandler.ts";
import { callHook as call12 } from "./spreadByTheHandler.ts";
import { callHook as call13 } from "./aBoundFunction.ts";
import { callHook as call14 } from "./readByNameInTheHandler.ts";
import { callHook as call15 } from "./behindCatchAndHandedOn.ts";
import { callHook as call16 } from "./theHandlerIsCalledElsewhereToo.ts";
import { callHook as call17 } from "./aMemberOfThePromiseByAKey.ts";
const lines: string[] = [];
function say(label: string, ...values: unknown[]): void { lines.push(label + ": " + values.map(String).join(" | ")); }
function seven(): number { return 7; }
const hookWord: string = ["Hook"][lines.length];
const thenWord: string = ["then"][lines.length];
const held: any[] = [];
const kept: any[] = [];
function takes(ns: any): void { ns["set" + hookWord](seven); }
function takesList(list: any[]): void { list[0]["set" + hookWord](seven); }
const handlers: ((ns: any) => void)[] = [takes];
async function all(): Promise<void> {
    { say("handedOnByTheHandler, before", call0()); await import("./handedOnByTheHandler.ts").then(ns => takes(ns)); say("handedOnByTheHandler", call0()); }
    { say("anUnknownHandler, before", call1()); await import("./anUnknownHandler.ts").then(handlers[held.length]); say("anUnknownHandler", call1()); }
    { say("aRestParameter, before", call2()); await import("./aRestParameter.ts").then((...every: any[]) => every[0]["set" + hookWord](seven)); say("aRestParameter", call2()); }
    { say("theArgumentsObject, before", call3()); await import("./theArgumentsObject.ts").then(function () { arguments[0]["set" + hookWord](seven); }); say("theArgumentsObject", call3()); }
    { say("returnedAndHandedOn, before", call4()); takes(await import("./returnedAndHandedOn.ts").then(m => m)); say("returnedAndHandedOn", call4()); }
    { say("thePromiseOfThenIsKept, before", call5()); { const promise = import("./thePromiseOfThenIsKept.ts").then(m => m); kept.push(promise); (await kept[kept.length - 1])["set" + hookWord](seven); } say("thePromiseOfThenIsKept", call5()); }
    { say("aSecondHandler, before", call6()); await import("./aSecondHandler.ts").then(m => m).then(m => (m as any)["set" + hookWord](seven)); say("aSecondHandler", call6()); }
    { say("aWrittenTypeInTheHandler, before", call7()); await import("./aWrittenTypeInTheHandler.ts").then((m: { setHook(fn: () => number): void }) => m.setHook(seven)); say("aWrittenTypeInTheHandler", call7()); }
    { say("aComputedKeyInTheHandler, before", call8()); await import("./aComputedKeyInTheHandler.ts").then(m => (m as any)["set" + hookWord](seven)); say("aComputedKeyInTheHandler", call8()); }
    { say("theListIsHandedOn, before", call9()); await Promise.all([import("./theListIsHandedOn.ts")]).then(list => takesList(list)); say("theListIsHandedOn", call9()); }
    { say("passedThroughThenWithoutAHandler, before", call10()); { const ns: any = await import("./passedThroughThenWithoutAHandler.ts").then(undefined, () => undefined); ns["set" + hookWord](seven); } say("passedThroughThenWithoutAHandler", call10()); }
    { say("storedByTheHandler, before", call11()); { let found: any; await import("./storedByTheHandler.ts").then(m => { found = m; }); found["set" + hookWord](seven); } say("storedByTheHandler", call11()); }
    { say("spreadByTheHandler, before", call12()); { const copy: any = await import("./spreadByTheHandler.ts").then(m => ({ ...m })); copy.setHook(seven); } say("spreadByTheHandler", call12()); }
    { say("aBoundFunction, before", call13()); await import("./aBoundFunction.ts").then(takes.bind(null)); say("aBoundFunction", call13()); }
    { say("readByNameInTheHandler, before", call14()); await import("./readByNameInTheHandler.ts").then(m => m.setHook(seven)); say("readByNameInTheHandler", call14()); }
    { say("behindCatchAndHandedOn, before", call15()); takes(await import("./behindCatchAndHandedOn.ts").catch(() => undefined)); say("behindCatchAndHandedOn", call15()); }
    { say("theHandlerIsCalledElsewhereToo, before", call16()); { const both = (m: any) => m["set" + hookWord](seven); both({ setHook() {} }); await import("./theHandlerIsCalledElsewhereToo.ts").then(both); } say("theHandlerIsCalledElsewhereToo", call16()); }
    { say("aMemberOfThePromiseByAKey, before", call17()); await (import("./aMemberOfThePromiseByAKey.ts") as any)[thenWord]((m: any) => m["set" + hookWord](seven)); say("aMemberOfThePromiseByAKey", call17()); }
}
all().then(() => console.log(lines.join("\n")), error => console.log(lines.join("\n") + "\nfailed: " + error));

// FILE: aBoundFunction.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 13; }

// FILE: aComputedKeyInTheHandler.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 8; }

// FILE: aMemberOfThePromiseByAKey.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 17; }

// FILE: aRestParameter.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 2; }

// FILE: aSecondHandler.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 6; }

// FILE: aWrittenTypeInTheHandler.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 7; }

// FILE: anUnknownHandler.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 1; }

// FILE: behindCatchAndHandedOn.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 15; }

// FILE: handedOnByTheHandler.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 0; }

// FILE: passedThroughThenWithoutAHandler.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 10; }

// FILE: readByNameInTheHandler.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 14; }

// FILE: returnedAndHandedOn.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 4; }

// FILE: spreadByTheHandler.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 12; }

// FILE: storedByTheHandler.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 11; }

// FILE: theArgumentsObject.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 3; }

// FILE: theHandlerIsCalledElsewhereToo.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 16; }

// FILE: theListIsHandedOn.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 9; }

// FILE: thePromiseOfThenIsKept.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 5; }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: say seven both setHook
// CHECK-LABEL: function {{*}}name="say"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=Array site=[[w_2]] flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="lines"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = String string=": "
// CHECK-NEXT: v6 = Add v0, v5
// CHECK-NEXT: v7 = PropGet v1 key="map"
// CHECK-NEXT: v8 = Builtin builtin=String
// CHECK-NEXT: v9 = Call v7, v1, v8 calleeKey="map" calleeName="values.map"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|Array<undefined|null|string> site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v11 = PropGet v10 key="join"
// CHECK-NEXT: v12 = String string=" | "
// CHECK-NEXT: v13 = Call v11, v10, v12 calleeKey="join" calleeName="join"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v15 = Add v6, v14
// CHECK-NEXT: v16 = Call v4, v3, v15 calleeKey="push" calleeName="lines.push"
// CHECK-NEXT: v17 = Convert v16 declared={type=number site=[[w_5]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="seven"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_6]]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=7
// CHECK-NEXT: v1 = Convert v0 declared={type=number site=[[w_6]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="both"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v2 = String string="set"
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="hookWord"
// CHECK-NEXT: v5 = Add v2, v4
// CHECK-NEXT: v6 = ElemGet v1, v5
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v9 = Call v7, v1, v8
// CHECK-NEXT: ReturnCall v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="setHook"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
