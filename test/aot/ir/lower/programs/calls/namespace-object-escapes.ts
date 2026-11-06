// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 34

// FILE: main.ts
// A module whose exported setter nobody calls and nobody names, but whose namespace object gets away in one way a file: the setter is found all the same, and what it stores is called.
const lines: string[] = [];
function say(label: string, ...values: unknown[]): void { lines.push(label + ": " + values.map(String).join(" | ")); }
function seven(): number { return 7; }
const hookWord: string = ["Hook"][lines.length];
const held: any[] = [];
function takes(ns: any): void { ns["set" + hookWord](seven); }
import * as asAValue from "./asAValue.ts";
import { inner } from "./outer.ts";
import { callHook as callThis } from "./aMethodThatReadsThis.ts";
import { callHook as callThenable } from "./aThenable.ts";
import { callHook as call0 } from "./aComputedKey.ts";
import { callHook as call1 } from "./itsKeys.ts";
import { callHook as call2 } from "./itsValues.ts";
import { callHook as call3 } from "./aSpread.ts";
import { callHook as call4 } from "./anArgument.ts";
import { callHook as call5 } from "./aThen.ts";
import { callHook as call6 } from "./aFunctionThatReturnsThePromise.ts";
import { callHook as call7 } from "./aStore.ts";
import { callHook as call8 } from "./aForIn.ts";
import { callHook as call9 } from "./aRestInAPattern.ts";
import { callHook as call10 } from "./reflection.ts";
import { callHook as call11 } from "./aDescriptor.ts";
import { callHook as call12 } from "./itsName.ts";
import { callHook as call13 } from "./itsNameInAPattern.ts";
import { callHook as call14 } from "./promiseAll.ts";
import { callHook as call15 } from "./aWrittenType.ts";
import { callHook as call16 } from "./aJoin.ts";
import { callHook as call17 } from "./aClosure.ts";
import { callHook as callWhole } from "./exportedWhole.ts";
import { callHook as callList0 } from "./theListIsKept.ts";
import { callHook as callList1 } from "./theResultsAreHandedOn.ts";
import { callHook as callList2 } from "./aRestOfTheResults.ts";
import { callHook as callList3 } from "./aComputedIndex.ts";
import { callHook as callList4 } from "./aLoopOverTheResults.ts";
import { callHook as callList5 } from "./allSettled.ts";
import { callHook as callList6 } from "./aRace.ts";
import { callHook as callList7 } from "./thePromiseOfAllIsKept.ts";
import { callHook as callList8 } from "./aPromiseOfOnesOwn.ts";
import { callHook as callList9 } from "./takenApartAndReadByName.ts";
function takesList(list: any[]): void { list[0]["set" + hookWord](seven); }
const seenByMine: any[] = [];
class Mine<T> extends Promise<T> { static all(list: any): any { return Promise.all(list).then(results => { seenByMine.push(...results); return results; }); } }
async function all(): Promise<void> {
    { say("aComputedKey, before", call0()); const ns: any = await import("./aComputedKey.ts"); ns["set" + hookWord](seven); say("aComputedKey", call0()); }
    { say("itsKeys, before", call1()); const ns: any = await import("./itsKeys.ts"); for (const key of Object.keys(ns)) if (key.startsWith("set")) ns[key](seven); say("itsKeys", call1()); }
    { say("itsValues, before", call2()); const ns = await import("./itsValues.ts"); for (const value of Object.values(ns) as any[]) if (value.length === 1) value(seven); say("itsValues", call2()); }
    { say("aSpread, before", call3()); const copy: any = { ...(await import("./aSpread.ts")) }; copy.setHook(seven); say("aSpread", call3()); }
    { say("anArgument, before", call4()); takes(await import("./anArgument.ts")); say("anArgument", call4()); }
    { say("aThen, before", call5()); await import("./aThen.ts").then(ns => ns.setHook(seven)); say("aThen", call5()); }
    { say("aFunctionThatReturnsThePromise, before", call6()); const load = () => import("./aFunctionThatReturnsThePromise.ts"); (await load()).setHook(seven); say("aFunctionThatReturnsThePromise", call6()); }
    { say("aStore, before", call7()); held.push(await import("./aStore.ts")); held[held.length - 1].setHook(seven); say("aStore", call7()); }
    { say("aForIn, before", call8()); const ns: any = await import("./aForIn.ts"); for (const key in ns) if (key === "setHook") ns[key](seven); say("aForIn", call8()); }
    { say("aRestInAPattern, before", call9()); const { unrelated, ...rest } = await import("./aRestInAPattern.ts"); (rest as any).setHook(seven); say("unrelated", unrelated()); say("aRestInAPattern", call9()); }
    { say("reflection, before", call10()); const ns = await import("./reflection.ts"); Reflect.get(ns, "setHook")(seven); say("reflection", call10()); }
    { say("aDescriptor, before", call11()); const ns = await import("./aDescriptor.ts"); Object.getOwnPropertyDescriptor(ns, "setHook")!.value(seven); say("aDescriptor", call11()); }
    { say("itsName, before", call12()); (await import("./itsName.ts")).setHook(seven); say("itsName", call12()); }
    { say("itsNameInAPattern, before", call13()); const { setHook } = await import("./itsNameInAPattern.ts"); setHook(seven); say("itsNameInAPattern", call13()); }
    { say("promiseAll, before", call14()); const [ns] = await Promise.all([import("./promiseAll.ts")]); ns.setHook(seven); say("promiseAll", call14()); }
    { say("aWrittenType, before", call15()); const ns: { setHook(fn: () => number): void } = await import("./aWrittenType.ts"); ns.setHook(seven); say("aWrittenType", call15()); }
    { say("aJoin, before", call16()); const ns = hookWord.length > 2 ? await import("./aJoin.ts") : undefined; (ns as any)["set" + hookWord](seven); say("aJoin", call16()); }
    { say("aClosure, before", call17()); const ns = await import("./aClosure.ts"); const later = () => (ns as any)["set" + hookWord](seven); later(); say("aClosure", call17()); }
    { say("theListIsKept, before", callList0()); const list = [import("./theListIsKept.ts")]; held.push(list); const [ns] = await Promise.all(list); say("unrelated", ns.unrelated()); (await held[held.length - 1][0])["set" + hookWord](seven); say("theListIsKept", callList0()); }
    { say("theResultsAreHandedOn, before", callList1()); const results = await Promise.all([import("./theResultsAreHandedOn.ts")]); takesList(results); say("theResultsAreHandedOn", callList1()); }
    { say("aRestOfTheResults, before", callList2()); const [...every] = await Promise.all([import("./aRestOfTheResults.ts")]); (every[0] as any)["set" + hookWord](seven); say("aRestOfTheResults", callList2()); }
    { say("aComputedIndex, before", callList3()); const results = await Promise.all([import("./aComputedIndex.ts")]); (results[held.length - held.length] as any)["set" + hookWord](seven); say("aComputedIndex", callList3()); }
    { say("aLoopOverTheResults, before", callList4()); for (const ns of await Promise.all([import("./aLoopOverTheResults.ts")])) (ns as any)["set" + hookWord](seven); say("aLoopOverTheResults", callList4()); }
    { say("allSettled, before", callList5()); const [settled] = await Promise.allSettled([import("./allSettled.ts")]); (settled as any).value["set" + hookWord](seven); say("allSettled", callList5()); }
    { say("aRace, before", callList6()); const ns: any = await Promise.race([import("./aRace.ts")]); ns["set" + hookWord](seven); say("aRace", callList6()); }
    { say("thePromiseOfAllIsKept, before", callList7()); const promise = Promise.all([import("./thePromiseOfAllIsKept.ts")]); held.push(promise); const [ns] = await promise; say("unrelated", ns.unrelated()); (await held[held.length - 1])[0]["set" + hookWord](seven); say("thePromiseOfAllIsKept", callList7()); }
    { say("aPromiseOfOnesOwn, before", callList8()); const [ns] = await Mine.all([import("./aPromiseOfOnesOwn.ts")]); say("unrelated", ns.unrelated()); seenByMine[0]["set" + hookWord](seven); say("aPromiseOfOnesOwn", callList8()); }
    { say("takenApartAndReadByName, before", callList9()); const [first, { setHook }] = await Promise.all([import("./itsName.ts"), import("./takenApartAndReadByName.ts")]); say("unrelated", first.unrelated()); setHook(seven); say("takenApartAndReadByName", callList9()); }
    { say("asAValue, before", asAValue.callHook()); takes(asAValue); say("asAValue", asAValue.callHook()); }
    { say("exportedWhole, before", callWhole()); takes(inner); say("exportedWhole", callWhole()); }
    { say("aMethodThatReadsThis, before", callThis()); ((await import("./aMethodThatReadsThis.ts")).self() as any)["set" + hookWord](seven); say("aMethodThatReadsThis", callThis()); }
    { say("aThenable, before", callThenable()); say("what the await yields", await import("./aThenable.ts")); say("aThenable", callThenable()); }
}
all().then(() => console.log(lines.join("\n")), error => console.log(lines.join("\n") + "\nfailed: " + error));

// FILE: aClosure.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 17; }

// FILE: aComputedIndex.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 203; }

// FILE: aComputedKey.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 0; }

// FILE: aDescriptor.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 11; }

// FILE: aForIn.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 8; }

// FILE: aFunctionThatReturnsThePromise.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 6; }

// FILE: aJoin.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 16; }

// FILE: aLoopOverTheResults.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 204; }

// FILE: aMethodThatReadsThis.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 102; }
export function self(this: unknown): unknown { return this; }

// FILE: aPromiseOfOnesOwn.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 208; }

// FILE: aRace.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 206; }

// FILE: aRestInAPattern.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 9; }

// FILE: aRestOfTheResults.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 202; }

// FILE: aSpread.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 3; }

// FILE: aStore.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 7; }

// FILE: aThen.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 5; }

// FILE: aThenable.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 103; }
export function then(this: any, resolve: (value: unknown) => void): void { this["setHook"](() => 9); resolve("resolved by the module's own then"); }

// FILE: aWrittenType.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 15; }

// FILE: allSettled.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 205; }

// FILE: anArgument.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 4; }

// FILE: asAValue.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 100; }

// FILE: exportedWhole.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 101; }

// FILE: itsKeys.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 1; }

// FILE: itsName.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 12; }

// FILE: itsNameInAPattern.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 13; }

// FILE: itsValues.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 2; }

// FILE: outer.ts
export * as inner from "./exportedWhole.ts";

// FILE: promiseAll.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 14; }

// FILE: reflection.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 10; }

// FILE: takenApartAndReadByName.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 209; }

// FILE: theListIsKept.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 200; }

// FILE: thePromiseOfAllIsKept.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 207; }

// FILE: theResultsAreHandedOn.ts
let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 201; }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: say seven Mine load later
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
// CHECK-LABEL: function {{*}}name="Mine"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_8]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_8]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="load"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=undefined|null|Promise<undefined|null|object> flags=[IsExpected, OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = ImportModule module=[[m_10]] referrer=[[m_0]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|Promise<undefined|null|object> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="later"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] captures=[{type=undefined|null|object site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v2 = String string="set"
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="hookWord"
// CHECK-NEXT: v5 = Add v2, v4
// CHECK-NEXT: v6 = ElemGet v1, v5
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_14]]
// CHECK-NEXT: v9 = Call v7, v1, v8
// CHECK-NEXT: ReturnCall v9
// CHECK-NEXT: }
