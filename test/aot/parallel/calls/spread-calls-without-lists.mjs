// f(a, b, ...iterable): what the iterable gives is a list at the spread, which is the iterable itself where it is a pristine array; the call's stub reads the words and that list.
// The lists are empty, short, longer than the registers, of integers, doubles, holes and values, frozen, changed by the callee, arguments of a rest parameter, and lists whose iterator the program replaces.
// The callees are compiled closures of few and of many parameters, with rest parameters and arguments objects, methods, bound functions, builtins, proxies, classes' methods, generators, and values that cannot be called.
// STATISTIC: ListCallsWithoutLists >= 20
const atRunTime = (value) => [value][Math.min(0, process.pid)];
const out = [];
const show = (value) => typeof value === "bigint" ? value + "n" : Object.is(value, -0) ? "-0" : Array.isArray(value) ? "[" + Array.from(value, show) + "]" : typeof value === "function" ? "f" : typeof value === "object" && value ? "{" + Object.keys(value) + "}" : String(value);
const note = (...values) => { out.push(values.map(show).join(" ")); };

function none() { return "none" + arguments.length; }
function one(a) { return show(a); }
function three(a, b, c) { return [a, b, c].map(show).join("/"); }
function nine(a, b, c, d, e, f, g, h, i) { return [a, b, c, d, e, f, g, h, i].map(show).join("/") + arguments.length; }
function rest(a, ...others) { others.push("pushed"); return show(a) + others.map(show).join("/"); }
function defaults(a, b = "B", { c } = { c: "C" }, ...others) { return [a, b, c, others.length].map(show).join("/"); }
function count() { return arguments.length; }
function self() { return show(this && this.name) + arguments.length; }
function* generated(a, ...others) { yield a; yield* others; }
async function later(a, ...others) { return a + others.length; }
const arrow = (a, b, ...others) => [a, b, others.length].map(show).join("|");
const object = { name: "object", method(a, b) { return this.name + show(a) + show(b) + arguments.length; } };
class Base { constructor(name) { this.name = name; } method(...values) { return this.name + values.length + show(values[values.length - 1]); } }
class Heir extends Base { method(a, ...values) { return "heir" + super.method(a, ...values); } }
const heir = new Heir("h");
const bound = three.bind({ name: "bound" }, "first");
const proxied = new Proxy(three, { apply: (target, thisValue, list) => "proxy" + list.length + target(...list) });
const callees = [none, one, three, nine, rest, defaults, count, self, arrow, bound, proxied, Math.max, Math.min, String.prototype.concat.bind("s"), Array.of, (a) => a, JSON.stringify, object.method.bind(object), (a, ...v) => heir.method(a, ...v), (a, ...v) => [...generated(a, ...v)].map(show).join()];

const holes = [1, , 3];
const doubles = [1.5, -0, NaN, 4];
const frozen = Object.freeze(["x", "y"]);
const lists = [[], [1], [1, 2], ["a", "b", "c"], [1, 2, 3, 4], [1, "b", null, undefined, 5.5], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], doubles, [0.5], holes, [, ,], frozen, [undefined], [[]], [{}], ["s", Symbol.iterator, 1n], Array.from({ length: 70 }, (_, i) => i), new Array(3), [1, 2, 3].slice(1)];

function callOne(f, a, list) { return f(a, ...list); }
function callTwo(f, a, b, list) { return f(a, b, ...list); }
function callThree(f, a, b, c, list) { return f(a, b, c, ...list); }
function callFour(f, a, b, c, d, list) { return f(a, b, c, d, ...list); }
function callNumbers(f, list) { return f(1.5, 2, ...list); }
function callMethod(o, a, list) { return o.method(a, ...list); }
function twice(f, a, list) { const x = f(f(a, ...list), a, ...list); return x; }
function forwards(f, a, ...list) { return f(a, ...list); }
function inLoop(f, list) { let r = ""; for (let i = 0; i < 3; i++) r += f(i, ...list) + ";"; return r; }
function changed(list) { return rest(list.length, (list.push("late"), "now"), ...list); }
function changedByCallee(list) { const take = (a, ...others) => { list.length = 0; return others.length + list.length; }; return take(1, ...list) + "," + list.length; }
function caught(f, a, list) { try { return f(a, ...list); } catch (error) { return error.constructor.name + ":" + error.message; } }
function nested(f, a, list, other) { return f(a, f(a, ...other), ...list); }

const text = (f) => { try { return show(f()); } catch (error) { return error.constructor.name + ":" + error.message; } };
for (const f of callees) {
  for (const list of lists) {
    note(text(() => callOne(f, "a", list)), text(() => callTwo(f, "a", 2, list)), text(() => callThree(f, 1, "b", {}, list)), text(() => callFour(f, 1, 2, 3, 4, list)), text(() => callNumbers(f, list)), text(() => twice(f, "q", list)), text(() => forwards(f, "f", ...list)), text(() => inLoop(f, list)), text(() => nested(f, "n", list, lists[1])));
  }
}
for (const list of lists) note(text(() => callMethod(object, 1, list)), text(() => callMethod(heir, 1, list)));
for (const f of [undefined, null, 1, "s", {}, [], Symbol.iterator, Base, Map]) note(caught(f, 1, [2, 3]), caught(f, 1, []));
note(text(() => changed([1, 2])), text(() => changedByCallee([1, 2, 3])));
later(1, ...atRunTime([2, 3])).then((value) => console.log("later", value));
for (const list of [new Set([1, 2]), new Map([[1, 2]]), "text", null, undefined, 5, { length: 2, 0: "a", 1: "b" }, (function () { return arguments; })(7, 8), new Uint8Array([1, 2])]) note(text(() => callOne(rest, "a", list)), text(() => callTwo(rest, "a", "b", list)));

const large = Array.from({ length: 5000 }, (_, i) => i);
note(callOne(count, 0, large), callTwo(count, 0, 1, large), text(() => callOne(Math.max, 5, large)));
let depth = 0;
function recursive(n, ...list) { depth++; return n ? recursive(n - 1, ...list) : list.length; }
note(recursive(200, ...large.slice(0, 3)), depth);

// Iterables that run code of the program: in order, once, and with their errors.
const log = [];
const steps = (name, n, fails) => ({ [Symbol.iterator]() { log.push(name); let i = 0; return { next() { log.push(i); if (i === fails) throw new Error("next " + i); return { done: i === n, value: i++ }; }, return() { log.push("return"); return {}; } }; } });
const later2 = (f, iterable) => { try { return show(f((log.push("first"), 1), ...iterable)); } catch (error) { return error.message + (error.stack.includes("later2") ? " in later2" : ""); } };
for (const f of [rest, three, undefined, Math.max, count]) note(later2(f, steps("a", 3)), later2(f, steps("b", 12)), later2(f, steps("c", 3, 1)), later2(f, steps("d", 0)), later2(f, new Set([1, 2, 3])), later2(f, "s\u{1F600}t"), later2(f, 5), later2(f, null), later2(f, generated(1, 2, 3)));
note(log.join());
const args = [1, 2];
Object.defineProperty(args, "length", { writable: false });
note(later2(rest, args), later2(rest, Object.freeze([, 1])), later2(rest, new (class extends Array {})(3)), later2(three, new Proxy([1, 2], {})));

// The program replaces how lists are iterated.
const plain = [1, 2, 3];
const own = [1, 2, 3];
own[Symbol.iterator] = function* () { yield "own"; };
class Listed extends Array { *[Symbol.iterator]() { yield "listed"; } }
note(callOne(rest, "a", plain), callOne(rest, "a", own), callOne(rest, "a", Listed.from([1, 2])), callTwo(three, 1, 2, own));
console.log(out.length, Bun.hash(out.join("~")).toString(36));
for (const line of out.slice(0, 60)) console.log(line);
