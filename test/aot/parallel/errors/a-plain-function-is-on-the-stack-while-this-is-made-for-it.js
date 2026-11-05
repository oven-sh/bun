// `new.target.prototype` is read to make `this`, and reading it may run any code: a getter, a trap of a proxy, or the error of a revoked proxy.
// A plain function is on the stack by then, as `new A`, at the first position that it records, or at its parameters where it records none.
function frames(stack) {
  const lines = String(stack).split("\n").slice(1);
  return lines.map(line => line.trim().replace(/\(?[^ (]*[\\/]/, "(").replace(/^at \(/, "at (")).filter(line => line.includes(".js:")).join(" | ");
}
function A(a) { this.a = a; }
const Kept = function (a) { if (a) this.a = a; };
function Empty() {}
function Leaves(a) { "use strict"; return frames(a); }
function ReadsNewTarget(a) { this.target = new.target; }
function HasDefault(a = frames("")) { this.a = a; }
function OverLines(
  a,
) {
  const b = a;

  this.b = b.toString();
}
class Below extends A { constructor(a) { super(a); } }
class BelowWithoutConstructor extends Kept {}
const Bound = A.bind(null, 2);
function Renamed(a) { this.a = a; }
Object.defineProperty(Renamed, "name", { value: "NamedAnew" });
class BelowRenamed extends Renamed {}

function thrown(constructor) {
  const target = function () {}.bind();
  Object.defineProperty(target, "prototype", { get() { throw new RangeError("no prototype"); } });
  try { Reflect.construct(constructor, [1], target); return "made"; } catch (error) { return error.name + ": " + frames(error.stack); }
}
function captured(constructor) {
  let seen = "not read";
  const target = function () {}.bind();
  Object.defineProperty(target, "prototype", { get() { seen = frames(new Error().stack); return constructor.prototype; } });
  Reflect.construct(constructor, [1], target);
  return seen;
}
function trapped(constructor) {
  let seen = "not read";
  const proxy = new Proxy(constructor, { get(target, key) { if (key === "prototype") seen = frames(new Error().stack); return target[key]; } });
  new proxy(1);
  return seen;
}
function revoked(constructor) {
  const { proxy, revoke } = Proxy.revocable(constructor, {});
  revoke();
  try { Reflect.construct(constructor, [1], proxy); return "made"; } catch (error) { return error.name + ": " + frames(error.stack); }
}
function calledSites(constructor) {
  let seen = "not read";
  const target = function () {}.bind();
  Object.defineProperty(target, "prototype", {
    get() {
      const prepare = Error.prepareStackTrace;
      Error.prepareStackTrace = (error, sites) => sites.slice(0, 3).map(site => `${site.getFunctionName()} ${site.isConstructor()} ${site.getLineNumber()}:${site.getColumnNumber()}`).join(" | ");
      seen = new Error().stack;
      Error.prepareStackTrace = prepare;
      return constructor.prototype;
    },
  });
  Reflect.construct(constructor, [1], target);
  return seen;
}
function cutAtConstructor(constructor) {
  let seen = "not read";
  const target = function () {}.bind();
  Object.defineProperty(target, "prototype", { get() { const holder = {}; Error.captureStackTrace(holder, constructor); seen = frames(holder.stack); return constructor.prototype; } });
  Reflect.construct(constructor, [1], target);
  return seen;
}
function limited(constructor) {
  let seen = "not read";
  const target = function () {}.bind();
  Object.defineProperty(target, "prototype", { get() { const limit = Error.stackTraceLimit; Error.stackTraceLimit = 2; seen = frames(new Error().stack); Error.stackTraceLimit = limit; return constructor.prototype; } });
  Reflect.construct(constructor, [1], target);
  return seen;
}
function nested(constructor) {
  let seen = "not read";
  const inner = function () {}.bind();
  Object.defineProperty(inner, "prototype", { get() { seen = frames(new Error().stack); return Kept.prototype; } });
  const outer = function () {}.bind();
  Object.defineProperty(outer, "prototype", { get() { Reflect.construct(Kept, [1], inner); return constructor.prototype; } });
  Reflect.construct(constructor, [1], outer);
  return seen;
}
const constructors = [A, Kept, Empty, Leaves, ReadsNewTarget, HasDefault, OverLines, Below, BelowWithoutConstructor, Bound, Renamed, BelowRenamed];
for (let round = 0; round < 2; round++) {
  for (const constructor of constructors) {
    for (const way of [thrown, captured, trapped, revoked, calledSites, cutAtConstructor, limited, nested]) console.log(constructor.name, way.name, way(constructor));
  }
}
