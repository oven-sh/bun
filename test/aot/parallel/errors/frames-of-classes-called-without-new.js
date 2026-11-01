// Prints the frames of the error that a class throws when it is called without `new`.
const listFrames = error =>
  error.stack
    .split("\n")
    .slice(1, 5)
    .map(line => line.trim().replace(/\(?[^\s()]*[\\/]/, "(").replace(/native:\d+:\d+/, "native"))
    .join(" | ");
function show(label, call) {
  try {
    call();
    console.log(label, "did not throw");
  } catch (error) {
    console.log(label, "|", error.message, "|", listFrames(error), "|", error.line, error.column);
  }
}
class Written { constructor() {} }
class Default {}
class DerivedDefault extends Written {}
class DerivedWritten extends Written { constructor() { super(); } }
const Expression = class { constructor(a, b) {} };
const NamedExpression = class Inner { constructor ( a ) {} };
class OverLines {
  field = 1;
  static count = 2;
  constructor() {}
}
class BehindAMethod { method() {} constructor(a = 1, { b } = {}) {} }
function makeClass() { return class { constructor() {} }; }
function callAndKeep(f) { const result = f(); return [result]; }

show("written", () => { Written(); });
show("default", () => { Default(); });
show("derived default", () => { DerivedDefault(); });
show("derived written", () => { DerivedWritten(); });
show("expression", () => { Expression(); });
show("named expression", () => { NamedExpression(); });
show("over lines", () => { OverLines(); });
show("behind a method", () => { BehindAMethod(); });
show("made by a function", () => { makeClass()(); });
show("call", () => { Written.call({}); });
show("apply", () => { Written.apply({}, []); });
show("Reflect.apply", () => { Reflect.apply(Written, null, []); });
show("bound", () => { Written.bind(null)(); });
show("map", () => { [1].map(Written); });
show("forEach", () => { [1].forEach(Default); });
show("sort", () => { [2, 1].sort(Written); });
show("replace", () => { "a".replace("a", Written); });
show("handed to a function", () => { callAndKeep(Written); });
show("tag", () => { Written``; });
show("getter", () => { Object.defineProperty({}, "x", { get: Written }).x; });
show("proxy", () => { new Proxy(Written, {})(); });
show("optional call", () => { Written?.(); });
show("member", () => { ({ Written }).Written(); });
show("spread", () => { Written(...[1, 2]); });
show("reviver", () => { JSON.parse("1", Written); });
show("one frame", () => {
  Error.stackTraceLimit = 1;
  try { Written(); } finally { Error.stackTraceLimit = 10; }
});

Error.prepareStackTrace = (error, sites) =>
  sites
    .slice(0, 2)
    .map(site => [site.getFunctionName(), site.isConstructor(), site.isNative(), site.getLineNumber(), site.getColumnNumber()].join())
    .join(" | ");
for (const called of [Written, Default, DerivedDefault, DerivedWritten, Expression, NamedExpression, OverLines]) {
  try {
    called();
  } catch (error) {
    console.log("call sites", error.stack);
  }
}
Error.prepareStackTrace = undefined;

Promise.resolve()
  .then(Written)
  .catch(error => console.log("promise job |", listFrames(error)));
