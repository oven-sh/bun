// Where `require()` of an ES module differs from an import: the module is evaluated at the call, once; a destructured name is a copy; the variable that holds the module has a dead zone of its own; the object is the one that `import *` yields and says `__esModule` from the first `require` on.
import { log, attempt } from "./log";
import * as marked from "./marked";
import * as markedLate from "./marked-late";
import * as marksItself from "./marks-itself";
import "./typed";
type Required = [typeof import("./effects"), typeof import("./effects-late"), typeof import("./marked-before-it-is-made"), typeof import("./whole-export"), typeof import("./throws"), typeof import("./types-alone")];

log("1 order");
log("before");
const first = require("./effects").value;
log("between", first);
const { value: again } = require("./effects");
log("after", again);
function lazily() {
  log("in the function");
  return require("./effects-late").value;
}
log(lazily(), lazily());

log("2 copies and live bindings");
const live = require("./counter") as typeof import("./counter");
const { count: copied, read, replaced: copyOfReplaced } = require("./counter") as typeof import("./counter");
live.increment();
live.replace();
log(copied, live.count, require("./counter").count, read(), copyOfReplaced(), live.replaced(), require("./counter").replaced());

log("3 dead zones of the variables");
function readsEarly() {
  return early.count;
}
function readsCopyEarly() {
  return earlyCopy;
}
function typeofEarly() {
  return typeof early;
}
log(attempt(readsEarly), attempt(readsCopyEarly), attempt(typeofEarly));
const early = require("./counter") as typeof import("./counter");
const { count: earlyCopy } = require("./counter") as typeof import("./counter");
log(attempt(readsEarly), attempt(readsCopyEarly), attempt(typeofEarly));

log("4 the mark");
const seen = (ns: object) => String((ns as any).__esModule) + ":" + Object.keys(ns).join();
log(seen(marked), seen(markedLate), Object.keys(marksItself).join());
log(require("./marked").a, seen(marked), require("./marked").__esModule);
const { a: ofLate } = require("./marked-late");
log(ofLate, seen(markedLate));
log(require("./marks-itself").a, Object.keys(marksItself).join(), require("./marks-itself").__esModule, require("./marks-itself") === marksItself);
require("./marked-before-it-is-made");
log(seen(await import("./marked-before-it-is-made")));
log(seen(await import("./never-required")));

log("5 as a value");
const whole = require("./marked") as typeof import("./marked");
const key = "a";
log(whole === marked, typeof whole, Object.keys(whole).join(), (whole as any)[key], JSON.stringify(whole), JSON.stringify({ ...whole }), String(Object.prototype.toString.call(whole)));
log([whole].includes(marked), ((given: unknown) => given === marked)(whole), (() => whole)() === marked);
for (const name in whole) log(name);
log(attempt(() => ((whole as any).a = 5)), attempt(() => delete (whole as any).a), attempt(() => ((require("./marked") as any).a = 6)), whole.a);
log((whole as any).absent, (require("./marked") as any).absent, (whole as any).toString, (whole as any)["absent"]);
const { absent = "by default", a: present = "unused" } = require("./marked") as any;
log(absent, present);
const { a: one, ...others } = require("./marked") as any;
log(one, JSON.stringify(others));

log("6 this");
log(whole.self() === marked, require("./marked").self() === marked, whole.strict(), (0, whole.self)() === undefined);

log("7 another require");
function shadowed(require: (name: string) => unknown) {
  return require("./marked");
}
log(shadowed(name => "mine: " + name));
{
  const require = (name: string) => ({ a: "inner " + name });
  log(require("./marked").a);
}

log("8 module.exports");
log(JSON.stringify(require("./whole-export")), require("./whole-export").a, typeof require("./whole-export"));

log("9 a module that throws");
log(attempt(() => require("./throws").a), attempt(() => require("./throws").a), attempt(() => { const { a } = require("./throws"); return a; }));

log("10 types alone");
log((require("./types-alone") as any).OnlyAType, Object.keys(require("./types-alone")).join());

log("11 closures");
function makes() {
  const inner = require("./counter") as typeof import("./counter");
  return () => inner.count + (inner === live ? 1000 : 0);
}
log(makes()());

log("12 this, for a function that is not known");
{
  const hooks = require("./hooks") as typeof import("./hooks");
  log(hooks.ofAnObject(), hooks.called(), hooks.changing(), hooks.made(), (require("./hooks") as typeof import("./hooks")).ofAnObject());
  hooks.swap();
  log(hooks.changing(), hooks.arrow(), hooks.looksAtNothing());
}

log("13 looked at as any, or as another type");
{
  const { twice, describe, kept } = require("./typed");
  const typed = require("./typed");
  type Other = { twice(n: unknown): unknown; kept(): unknown; describe(root: unknown): string };
  const other = require("./typed") as Other;
  log(require("./typed").twice(2), twice(3), typed.twice(4), other.twice(5), (require("./typed") as Other).twice(6));
  log(describe(kept()), typed.describe(typed.kept()), other.describe(other.kept()), typed === other, Object.keys(typed).join());
}
