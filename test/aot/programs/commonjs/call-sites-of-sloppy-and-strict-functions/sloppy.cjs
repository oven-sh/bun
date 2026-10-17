function sites(count) {
  const before = Error.prepareStackTrace;
  Error.prepareStackTrace = (error, frames) => frames;
  const frames = new Error().stack;
  Error.prepareStackTrace = before;
  return frames
    .slice(1, count + 1)
    .map(frame => (frame.getFunctionName() || "anonymous") + (frame.isToplevel() ? " toplevel" : "") + (frame.isNative() ? " native" : "") + (frame.isConstructor() ? " constructor" : ""))
    .join(" < ");
}
function declared() { return sites(1); }
const expression = function () { return sites(1); };
const arrow = () => sites(1);
const literal = { method() { return sites(1); }, get getter() { return sites(1); }, arrow: () => sites(1) };
class Class {
  method() { return sites(2) + ""; }
  static method() { return sites(2) + ""; }
  static callback() { return sites(3) + ""; }
  withArrow() { return (() => sites(3) + "")() + ""; }
  callsSloppy() { return declaredTwo() + ""; }
}
class WithConstructor { constructor() { this.at = sites(2) + ""; } }
function declaredTwo() { return sites(3); }
function callsArrowInMethod() { return new Class().withArrow(); }
function sloppyBelowAndAboveStrict() { return new Class().callsSloppy(); }
function callsMethod() { return new Class().method(); }
function callsStaticMethod() { return Class.method(); }
function constructsClass() { return new WithConstructor().at; }
function Made() { this.at = sites(2); }
function constructs() { return new Made().at; }
function belowMap() { return [0].map(function inMap() { return sites(3); })[0]; }
function belowForEach() { let said; [0].forEach(function inForEach() { said = sites(3); }); return said; }
function belowFilter() { let said; [0].filter(function inFilter() { said = sites(3); }); return said; }
function belowReduce() { return [0, 1].reduce(function inReduce() { return sites(3); }); }
function belowSort() { let said; [1, 0].sort(function inSort() { said ??= sites(3); return 0; }); return said; }
function belowMapForEach() { let said; new Map([[1, 2]]).forEach(function inMapForEach() { said = sites(3); }); return said; }
function belowStrictCallback() { return [0].map(Class.callback)[0]; }
async function asyncBeforeAwait() { return sites(1); }
async function asyncAfterAwait() { await 1; return sites(1); }
function* generator() { yield sites(1); }
function viaCall() { return declared.call(undefined); }
function viaApply() { return declared.apply({}, []); }
function viaBind() { return declared.bind(null)(); }
function twoSloppy() { return (function inner() { return sites(2); })(); }
exports.rows = {
  "a declared function": declared,
  "a function expression": expression,
  "an arrow function": arrow,
  "a method of a literal": () => literal.method(),
  "a getter of a literal": () => literal.getter,
  "an arrow in a literal": () => literal.arrow(),
  "two sloppy functions": twoSloppy,
  "an arrow in a method of a class": callsArrowInMethod,
  "a sloppy function called by a method called by a sloppy function": sloppyBelowAndAboveStrict,
  "a method of a class": callsMethod,
  "a static method": callsStaticMethod,
  "the constructor of a class": constructsClass,
  "a sloppy constructor": constructs,
  "below map": belowMap,
  "below forEach": belowForEach,
  "below filter": belowFilter,
  "below reduce": belowReduce,
  "below sort": belowSort,
  "below Map.prototype.forEach": belowMapForEach,
  "a strict callback below map": belowStrictCallback,
  "an async function before its first await": asyncBeforeAwait,
  "an async function after an await": asyncAfterAwait,
  "a generator": () => generator().next().value,
  "through call": viaCall,
  "through apply": viaApply,
  "through bind": viaBind,
  "down to the module that is strict": () => sites(4),
};
