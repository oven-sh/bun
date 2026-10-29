// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 4

// FILE: main.ts
// `require()` of an ES module binds as an import does: a member, a pattern and a constant that holds the module read what the module declares. No object is made, nothing is looked up by name, and functions are called directly.
import { log } from "./log";
type Lib = typeof import("./lib");

function memberOfTheCall() {
  return (require("./lib") as Lib).constant + (require("./lib") as Lib).twice(4) + (require("./lib") as Lib).counter + (require("./lib") as Lib).arrow(1) + (require("./lib") as Lib).default;
}
function keyOfTheCall() {
  return (require("./lib") as Lib)["constant"] + (require("./lib") as Lib)["counter"];
}
function pattern() {
  const { constant, twice, counter: seen = -1, arrow, default: byDefault } = require("./lib") as Lib;
  return constant + twice(5) + seen + arrow(2) + byDefault;
}
function keptByClosures() {
  const { word, kind, constant } = require("./lib") as Lib;
  return [() => word, () => kind, () => constant];
}
function asItComes() {
  const { constant, twice, arrow } = require("./lib");
  return constant + twice(5) + arrow(2) + require("./lib").constant + require("./lib").twice(4) + require("./lib").arrow(1) + require("./lib").counter;
}
function held() {
  const lib = require("./lib") as typeof import("./lib");
  return lib.constant + lib.twice(6) + lib.counter + lib.arrow(3) + lib.default;
}
function heldAndChained() {
  const lib = require("./lib") as typeof import("./lib");
  return lib?.twice(7) + lib!.constant + lib.counter;
}
const atTheTop = require("./lib") as typeof import("./lib");
function readsTheTop() {
  return atTheTop.twice(atTheTop.constant) + atTheTop.counter;
}
const decided = true ? (require("./lib") as typeof import("./lib")) : null;
function readsWhatTheBuildDecided() {
  return decided!.twice(8) + (decided?.constant ?? 0);
}
function patternOverTheHeld() {
  const { twice, constant } = atTheTop;
  return twice(constant);
}
function throughABarrel() {
  const barrel = require("./barrel") as typeof import("./barrel");
  return barrel.twice(9) + barrel.renamed + (require("./barrel") as typeof import("./barrel")).inner.constant;
}
function forNothing() {
  require("./lib");
  void require("./lib");
  return 1;
}
function constructs() {
  const { Box } = require("./lib") as typeof import("./lib");
  const lib = require("./lib") as typeof import("./lib");
  return new Box(1).value + new lib.Box(2).value + Number(new Box(3) instanceof lib.Box);
}
function onlyTests() {
  if (!decided) return -1;
  return decided && atTheTop ? decided.twice(10) : -2;
}
function asAValue(key: string) {
  const lib: Record<string, unknown> = require("./lib");
  return lib[key];
}

log("main begins");
for (const run of [asItComes, memberOfTheCall, keyOfTheCall, pattern, held, heldAndChained, readsTheTop, readsWhatTheBuildDecided, patternOverTheHeld, throughABarrel, forNothing, constructs, onlyTests]) log(run.name, run());
atTheTop.increment();
for (const run of [memberOfTheCall, keyOfTheCall, pattern, held, heldAndChained, readsTheTop]) log(run.name, run());
log(asAValue("constant"), asAValue("counter"), asAValue("absent"));
log(keptByClosures().map(run => run()).join());

// FILE: barrel.ts
export * from "./lib";
export { constant as renamed } from "./lib";
export * as inner from "./lib";

// FILE: lib.ts
import { log } from "./log";
log("lib is evaluated");
export const constant = 10;
export function twice(value: number) {
  return value * 2;
}
export let counter = 0;
export function increment() {
  counter++;
}
export const arrow = (value: number) => value + 100;
export class Box {
  constructor(public value: number) {}
}
export default 1000;
export const word = "abc";
export const kind: "x" | "y" = "x";

// FILE: log.ts
export function log(...values: unknown[]) {
  console.log(...values);
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: patternOverTheHeld constructs asAValue
// CHECK-LABEL: function {{*}}name="patternOverTheHeld"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_1]]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="atTheTop"
// CHECK-NEXT: v2 = TypeTest v1 testedType=undefined|null
// CHECK-NEXT: Branch v2 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v4 = NewRuntimeError runtimeError=NotDestructurable name="twice"
// CHECK-NEXT: Throw v4
// CHECK-NEXT: b4(v5):
// CHECK-NEXT: v6 = PropGet v5 key="twice"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[f_4]]} illTypedCause=Assertion
// CHECK-NEXT: v8 = PropGet v5 key="constant"
// CHECK-NEXT: v9 = Convert v8 declared={type=10} illTypedCause=Assertion
// CHECK-NEXT: v10 = Call v7, -, v9 calleeName="twice"
// CHECK-NEXT: ReturnCall v10 casts=[{declared={type=number site=[[w_5]]}}, {declared={type=number site=[[w_1]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="constructs"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_6]]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: RecordRequire module=[[m_8]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_8]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_8]] referrer=[[m_0]]
// CHECK-NEXT: v3 = Boolean boolean=true
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|object site=[[w_9]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="Box"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_11]]} illTypedCause=Assertion
// CHECK-NEXT: RecordRequire module=[[m_8]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_8]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_8]] referrer=[[m_0]]
// CHECK-NEXT: v12 = Boolean boolean=true
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|object site=[[w_12]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v15 = Integer integer=1
// CHECK-NEXT: v16 = Construct v8, -, v15 calleeName="Box"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|[[L_13]] site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v18 = PropGet v17 key="value"
// CHECK-NEXT: v19 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v20 = CheckInitialized v19 name="Box"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|[[f_11]] site=[[w_15]]} illTypedCause=Assertion
// CHECK-NEXT: v22 = Integer integer=2
// CHECK-NEXT: v23 = Construct v21, -, v22 calleeName="lib.Box"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|[[L_13]] site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v25 = PropGet v24 key="value"
// CHECK-NEXT: v26 = Add v18, v25
// CHECK-NEXT: v27 = Builtin builtin=Number
// CHECK-NEXT: v28 = Integer integer=3
// CHECK-NEXT: v29 = Construct v8, -, v28 calleeName="Box"
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|[[L_13]] site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v31 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v32 = CheckInitialized v31 name="Box"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|[[f_11]] site=[[w_18]]} illTypedCause=Assertion
// CHECK-NEXT: v34 = InstanceOf v30, v33
// CHECK-NEXT: v35 = Call v27, -, v34 calleeName="Number"
// CHECK-NEXT: v36 = Convert v35 declared={type=number site=[[w_19]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v37 = Add v26, v36
// CHECK-NEXT: v38 = Convert v37 declared={type=number site=[[w_6]]}
// CHECK-NEXT: Return v38
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="asAValue"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_20]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: RecordRequire module=[[m_8]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_8]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_8]] referrer=[[m_0]]
// CHECK-NEXT: v4 = ModuleNamespace module=[[m_8]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|object site=[[w_21]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v7 = ElemGet v6, v0
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
