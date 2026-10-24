// "Stored in a variable": a variable of the module, of an enclosing function, of a loop's round, a `var` that a closure made earlier already sees, a name that sloppy code creates on the global object by storing to it, a property of the global object, a static field, a label on the function itself, a parameter of an enclosing call.
function churn(depth) {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
const rare = t => t.n % 80 === 79;
let moduleLet = null;
var moduleVar = null;
function intoModuleLet(t) {
  if (rare(t)) moduleLet = t;
}
function intoModuleVar(t) {
  if (rare(t)) moduleVar = t;
}
function intoImplicitGlobal(t) {
  if (rare(t)) createdByAStore = t;
}
function intoGlobalProperty(t) {
  if (rare(t)) globalThis.onTheGlobalObject = t;
}
function intoSloppyThis(t) {
  if (rare(t)) this.throughSloppyThis = t;
}
class Statics {
  static held = null;
  static #hidden = null;
  static keep(t) {
    if (rare(t)) {
      Statics.held = t;
      Statics.#hidden = t;
    }
  }
  static reveal() {
    return Statics.#hidden;
  }
}
function intoItsOwnProperty(t) {
  if (rare(t)) intoItsOwnProperty.last = t;
}
function intoExports(t) {
  if (rare(t)) module.exports.last = t;
}
function makeScope() {
  let inScope = null;
  var inVar = null;
  const readBoth = () => [inScope, inVar];
  return {
    keep(t) {
      if (rare(t)) {
        inScope = t;
        inVar = t;
      }
    },
    readBoth,
  };
}
function intoParameterOfEnclosingCall(slot) {
  return {
    keep(t) {
      if (rare(t)) slot = t;
    },
    read: () => slot,
  };
}
function intoCatchVariable(t) {
  try {
    throw null;
  } catch (e) {
    e = t;
    return rare(t) ? () => e : null;
  }
}
function intoLoopVariable(t) {
  const readers = [];
  for (let held = null, i = 0; i < 2; i++) {
    held = i === 0 ? t : held;
    readers.push(() => held);
  }
  return rare(t) ? readers : null;
}
function intoHoistedVar(t) {
  const early = () => late;
  var late = t;
  return rare(t) ? early : null;
}
function intoFunctionName(t) {
  function replaced() {}
  const early = () => replaced;
  replaced = t;
  return rare(t) ? early : null;
}
function intoArgumentsObject(a, t) {
  arguments[0] = t;
  return rare(t) ? () => a : null;
}
function intoDestructuringTarget(t) {
  if (rare(t)) [moduleList[0], { x: moduleList[1] }] = [t, { x: t }];
}
const moduleList = [];
const scope = makeScope();
const enclosing = intoParameterOfEnclosingCall(null);
const thunks = [];
for (let i = 0; i < 160; i++) {
  const t = how => ({ n: i, tag: how + " " + i });
  intoModuleLet(t("module let"));
  intoModuleVar(t("module var"));
  intoImplicitGlobal(t("implicit global"));
  intoGlobalProperty(t("global property"));
  intoSloppyThis(t("sloppy this"));
  Statics.keep(t("static"));
  intoItsOwnProperty(t("own property"));
  intoExports(t("exports"));
  scope.keep(t("scope"));
  enclosing.keep(t("enclosing parameter"));
  intoDestructuringTarget(t("destructuring"));
  for (const made of [intoCatchVariable(t("catch variable")), intoHoistedVar(t("hoisted var")), intoFunctionName(t("function name")), intoArgumentsObject(null, t("arguments object"))]) if (made) thunks.push(made);
  const readers = intoLoopVariable(t("loop variable"));
  if (readers) thunks.push(...readers);
}
console.log(churn(80));
console.log([moduleLet, moduleVar, createdByAStore, globalThis.createdByAStore, onTheGlobalObject, throughSloppyThis, Statics.held, Statics.reveal(), intoItsOwnProperty.last, module.exports.last, ...scope.readBoth(), enclosing.read(), ...moduleList].map(t => t.tag).join(" | "));
console.log(thunks.map(f => f().tag).join(" | "));

// A variable is read by somebody else between two stores.
let shared = null;
const seen = [];
function publish(t, observe) {
  shared = t;
  observe();
  shared = null;
}
for (let i = 0; i < 200; i++) {
  publish({ n: i, tag: "published " + i }, () => {
    if (shared.n % 80 === 79) seen.push(shared);
  });
}
console.log(churn(60), shared, seen.map(t => t.tag).join(" | "));

// The variable dies with its scope, the value with the last closure over it.
function counterOver(t) {
  return { bump: () => ++t.n, read: () => t };
}
const counters = [];
for (let i = 0; i < 300; i++) {
  const c = counterOver({ n: i * 10, tag: "counted " + i });
  c.bump();
  if (i % 100 === 99) counters.push(c.read);
}
console.log(churn(60), counters.map(r => r().tag + "=" + r().n).join(" | "));
delete globalThis.createdByAStore;
delete globalThis.onTheGlobalObject;
delete globalThis.throughSloppyThis;
