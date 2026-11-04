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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="atTheTop"
// CHECK-NEXT: v2 = TypeTest v1 testedType=undefined|null
// CHECK-NEXT: Branch v2 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v3):
// CHECK-NEXT: v4 = NewRuntimeError runtimeError=NotDestructurable name="twice"
// CHECK-NEXT: Throw v4
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: v6 = PropGet v5 key="twice"
// CHECK-NEXT: v7 = PropGet v5 key="constant"
// CHECK-NEXT: v8 = Call v6, -, v7 calleeName="twice"
// CHECK-NEXT: ReturnCall v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="constructs"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: RecordRequire module=[[m_2]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_2]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_2]] referrer=[[m_0]]
// CHECK-NEXT: v3 = Boolean boolean=true
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|object flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="Box"
// CHECK-NEXT: RecordRequire module=[[m_2]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_2]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_2]] referrer=[[m_0]]
// CHECK-NEXT: v10 = Boolean boolean=true
// CHECK-NEXT: v11 = Integer integer=1
// CHECK-NEXT: v12 = Construct v6, -, v11 calleeName="Box"
// CHECK-NEXT: v13 = PropGet v12 key="value"
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v15 = CheckInitialized v14 name="Box"
// CHECK-NEXT: v16 = Integer integer=2
// CHECK-NEXT: v17 = Construct v15, -, v16 calleeName="lib.Box"
// CHECK-NEXT: v18 = PropGet v17 key="value"
// CHECK-NEXT: v19 = Add v13, v18
// CHECK-NEXT: v20 = Builtin builtin=Number
// CHECK-NEXT: v21 = Integer integer=3
// CHECK-NEXT: v22 = Construct v6, -, v21 calleeName="Box"
// CHECK-NEXT: v23 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v24 = CheckInitialized v23 name="Box"
// CHECK-NEXT: v25 = InstanceOf v22, v24
// CHECK-NEXT: v26 = Call v20, -, v25 calleeName="Number"
// CHECK-NEXT: v27 = Convert v26 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v28 = Add v19, v27
// CHECK-NEXT: Return v28
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="asAValue"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: RecordRequire module=[[m_2]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_2]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_2]] referrer=[[m_0]]
// CHECK-NEXT: v4 = ModuleNamespace module=[[m_2]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|object flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v6 = ElemGet v5, v0
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
