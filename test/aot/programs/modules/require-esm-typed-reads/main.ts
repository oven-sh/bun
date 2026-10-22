// `require()` of an ES module binds as an import does: a member, a pattern and a constant that holds the module read what the module declares. No object is made, nothing is looked up by name, and functions are called directly.
// IR= 0 memberOfTheCall PropGet|ElemGet|(Prop|Elem)Define| = Call v|CallMethod
// IR= 0 keyOfTheCall PropGet|ElemGet|(Prop|Elem)Define| = Call v|CallMethod
// IR= 0 pattern PropGet|ElemGet|(Prop|Elem)Define| = Call v|CallMethod
// IR= 0 held PropGet|ElemGet|(Prop|Elem)Define| = Call v|CallMethod
// IR= 0 heldAndChained PropGet|ElemGet|(Prop|Elem)Define| = Call v|CallMethod
// IR= 0 readsTheTop PropGet|ElemGet|(Prop|Elem)Define| = Call v|CallMethod
// IR= 0 readsWhatTheBuildDecided PropGet|ElemGet|(Prop|Elem)Define| = Call v|CallMethod
// IR= 0 patternOverTheHeld PropGet|ElemGet|(Prop|Elem)Define| = Call v|CallMethod
// IR= 0 throughABarrel PropGet|ElemGet|(Prop|Elem)Define| = Call v|CallMethod
// IR= 0 forNothing PropGet|ElemGet|(Prop|Elem)Define| = Call v|CallMethod|ModuleNamespace
// IR= 0 constructs PropGet|ElemGet|(Prop|Elem)Define
// IR= 0 onlyTests PropGet|ElemGet|(Prop|Elem)Define| = Call v|CallMethod|ToBoolean|TypeTest v[0-9]+ testedType=undefined\|null
// IR= 1 asAValue ElemGet
// IR= 0 keptByClosures PropGet|ElemGet|(Prop|Elem)Define| = Call v|CallMethod
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
