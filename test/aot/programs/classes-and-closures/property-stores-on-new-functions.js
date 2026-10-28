// Stores of new properties to newly made functions, as `wrapped.listener = listener` in once() of node:events: function expressions and declarations, arrow functions, methods, async functions, generators, bound functions of every kind and classes; that they are learnt; and that a bound function, which looks like any other until it is asked, stays a bound function.
// Only the jsc shell can count. Elsewhere the program checks the answers alone.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const lines = [];
const attempt = f => { try { return String(f()); } catch (error) { return error.constructor.name; } };
const show = f => Reflect.ownKeys(f).map(key => String(key) + "=" + (typeof f[key] === "object" && f[key] ? "object" : typeof f[key] === "function" ? "function" : String(f[key]))).join();
function wrap(target, listener) {
  let fired = false;
  const wrapped = function onceWrapper() {
    if (fired) return undefined;
    fired = true;
    return listener.call(target, arguments.length);
  };
  wrapped.listener = listener;
  return wrapped;
}
function arrow(i) { const f = () => i; f.tag = i; return f; }
function expression(i) { const f = function () { return i; }; f.displayName = "x" + i; f.order = i; return f; }
function named(i) { function inner() { return i; } inner.cache = [i]; inner.flush = () => inner.cache.pop(); inner.count = i; inner.more = 1; inner.yetMore = 2; inner.sixth = 6; inner.seventh = 7; inner.eighth = 8; inner.ninth = 9; return inner; }
function method(i) { const f = { m() { return i; } }.m; f.tag = i; return f; }
function asynchronous(i) { const f = async () => i; f.tag = i; return f; }
function generator(i) { const f = function* () { yield i; }; f.tag = i; return f; }
function klass(i) { const C = class { static fixed = 1; }; C.tag = i; C.other = i + 1; return C; }
function boundExpression(i) { const f = function () { return this; }.bind(i); f.tag = i; return f; }
function boundWithRest(i) { const state = { i }; const f = function (...all) { return this.i + all.length; }.bind(state, 1); f.tag = i; f.listener = state; f.third = 3; f.fourth = 4; f.fifth = 5; return f; }
function boundArrow(i) { const f = (() => i).bind(null); f.tag = i; return f; }
function boundMethod(i) { const holder = { i, m(a, b) { return this.i + a + b; } }; const f = holder.m.bind(holder, 1); f.tag = i; return f; }
function boundAsync(i) { const f = (async a => i + a).bind(null); f.tag = i; return f; }
function mark(g, value) { g.mark = value; return g; }
const learnt = [arrow, expression, named, method, asynchronous, generator, boundExpression, boundWithRest];
const others = [klass, boundArrow, boundMethod, boundAsync];
function sumOf(make, rounds) {
  let sum = 0;
  for (let i = 0; i < rounds; i++) { const f = make(i); sum += (f.tag ?? f.order ?? f.count) + Reflect.ownKeys(f).length; }
  return sum;
}
const kept = learnt.map(make => make(0));
kept.push(wrap(null, () => 0));
let warm = 0;
for (const make of learnt) warm += sumOf(make, 100);
for (let i = 0; i < 100; i++) warm += wrap({ i }, function (n) { return this.i + n; })(1, 2);
const before = count("operationAOTPutByIdAndCache");
let total = 0;
for (const make of learnt) total += sumOf(make, 1500);
for (let i = 0; i < 1500; i++) { const wrapped = wrap({ i }, function (n) { return this.i + n; }); total += wrapped(1, 2) + (wrapped() === undefined ? 1 : 0) + (typeof wrapped.listener === "function" ? 1 : 0); }
const entries = count("operationAOTPutByIdAndCache") - before;
lines.push(warm + " " + total + " " + kept.length);
lines.push(entries <= 200 ? "the run time was asked at most 200 times" : "the run time was asked " + entries + " times");
for (const make of [...learnt, ...others]) lines.push(make.name + " " + sumOf(make, 300) + " " + show(make(7)));
const beforeTheSecondCount = count("operationAOTPutByIdAndCache");
for (const make of learnt) total += sumOf(make, 1500);
const entriesBehindBoundFunctions = count("operationAOTPutByIdAndCache") - beforeTheSecondCount;
lines.push(entriesBehindBoundFunctions <= 200 ? "and behind bound functions at most 200 times" : "and behind bound functions " + entriesBehindBoundFunctions + " times", String(total));
lines.push(show(wrap(null, arrow(1))) + " " + wrap(null, arrow(1)).name + " " + wrap(null, arrow(1)).length + " " + ("prototype" in wrap(null, arrow(1))));

for (const make of [boundExpression, boundWithRest, boundArrow, boundMethod, boundAsync]) {
  const f = make(5);
  lines.push([make.name, f.name, f.length, "prototype" in f, Object.hasOwn(f, "tag"), attempt(() => ({}) instanceof f), attempt(() => new f()), attempt(() => typeof f(2, 3)), Object.getOwnPropertyNames(f).join()].join(" "));
  f.second = 2; f.third = 3; f.fourth = 4; f.fifth = 5;
  lines.push(show(f));
}
class Base {}
const boundClass = Base.bind(null);
boundClass.tag = 1;
lines.push([new Base() instanceof boundClass, {} instanceof boundClass, boundClass.tag, boundClass.name, "prototype" in boundClass, new boundClass() instanceof Base].join(" "));

let marked = 0;
for (let i = 0; i < 1500; i++) marked += mark(i % 3 === 0 ? () => i : i % 3 === 1 ? function () {} : (() => i).bind(null), i).mark;
lines.push("handed in " + marked + " " + show(mark(() => 1, 2)) + " | " + show(mark((() => 1).bind(null), 3)) + " | " + mark((() => 1).bind(null), 3).name);
lines.push(arrow(3)() + " " + expression(4)() + " " + named(5)() + " " + arrow(1).name + "|" + expression(1).name + "|" + arrow(1).length + " " + ("prototype" in arrow(1)) + " " + ("prototype" in expression(1)) + " " + (expression(1).prototype.constructor.order));

const seen = [];
const watching = Object.create(Function.prototype, { tag: { set(value) { seen.push("the setter got " + value); }, get() { return "from the getter"; } }, order: { value: "fixed", writable: false } });
const under = f => Object.setPrototypeOf(f, watching);
for (let i = 0; i < 3; i++) { const f = under(() => i); f.tag = i; f.other = i; lines.push(f.tag + " " + Object.hasOwn(f, "tag") + " " + f.other); }
lines.push(seen.join());
lines.push(attempt(() => { const f = under(function () {}); f.order = 1; return "stored " + f.order; }));
const quiet = Object.create(Function.prototype);
const below = f => Object.setPrototypeOf(f, quiet);
for (let i = 0; i < 3; i++) { const f = below(() => i); f.tag = i; lines.push(f.tag + " " + Object.hasOwn(f, "tag")); }
Object.defineProperty(quiet, "tag", { set(value) { seen.push("late: " + value); }, configurable: true });
for (let i = 0; i < 3; i++) { const f = below(() => i); f.tag = i; lines.push(f.tag + " " + Object.hasOwn(f, "tag")); }
lines.push(seen.splice(0).join());
lines.push(arrow(12).tag + " " + Object.hasOwn(arrow(13), "tag") + " " + expression(15).order);
lines.push(attempt(() => { const f = Object.freeze(() => 1); f.tag = 1; return "stored " + f.tag; }));
lines.push(attempt(() => { const f = Object.preventExtensions(function () {}); f.tag = 1; return "stored " + f.tag; }));
for (const name of ["name", "length", "caller", "arguments"]) {
  lines.push(name + ": " + attempt(() => { const f = () => 1; f[name] = "other"; return "stored " + f[name]; }) + " " + attempt(() => { const f = function () {}; f[name] = "other"; return "stored " + f[name]; }));
}
lines.push(attempt(() => { const f = () => 1; f.name = "other"; return "stored"; }) + " " + attempt(() => { const f = function () {}; f.length = 3; return "stored"; }));
const reprototyped = function () {};
reprototyped.prototype = { marker: true };
lines.push(String(new reprototyped().marker));
const arrowWithPrototype = () => 1;
arrowWithPrototype.prototype = { marker: true };
lines.push(show(arrowWithPrototype) + " " + attempt(() => new arrowWithPrototype()));
const heir = Object.create(arrow(20));
heir.tag = 21;
lines.push(heir.tag + " " + Object.getPrototypeOf(heir).tag + " " + Object.hasOwn(heir, "tag"));
const removed = arrow(30);
delete removed.tag;
removed.tag = 31;
lines.push(show(removed));
console.log(lines.join("\n"));
