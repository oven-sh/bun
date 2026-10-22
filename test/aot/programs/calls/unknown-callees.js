// One call site and one construct site see every kind of callee. Values thrown through catch, finally, async functions and generators arrive unchanged, and endless recursion ends in a RangeError.
"use strict";
Error.stackTraceLimit = 10;
const lines = [];
const events = [];

function callIt(callee, a, b) { const result = callee(a, b); return result; }
function constructIt(callee, a, b) { const result = new callee(a, b); return result; }

function render(value) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return typeof value + " " + String(value);
  const name = value.constructor === undefined ? "none" : value.constructor.name;
  return Object.prototype.toString.call(value) + " " + name + " " + JSON.stringify(value);
}
function outcome(run) {
  try {
    return render(run());
  } catch (error) {
    return "threw " + (error instanceof Error ? error.constructor.name : render(error));
  }
}
function takeEvents() { return events.length ? " [" + events.splice(0).join(", ") + "]" : ""; }

let captured = 10;
function closure(a, b) {
  if (new.target) {
    this.sum = a + b + captured;
    return;
  }
  return "closure " + (a + b + captured) + " " + typeof this;
}
const arrow = (a, b) => "arrow " + (a * b + captured);
class Point { constructor(a, b) { this.a = a; this.b = b; } }
class Point3 extends Point { constructor(a, b) { super(a, b); this.isNewTarget = new.target === Point3; } }
class ReturnsOther { constructor(a, b) { return { other: a + b }; } }
const holder = { method(a, b) { return "method " + (a - b) + " " + typeof this; }, get getter() { return "getter " + typeof this; } };
async function asyncFunction(a, b) { return a + b; }
function* generatorFunction(a, b) { yield a; yield b; }
const revocable = Proxy.revocable(closure, {});
revocable.revoke();

const callees = [
  ["closure", closure],
  ["arrow function", arrow],
  ["class", Point],
  ["derived class", Point3],
  ["class that returns an object", ReturnsOther],
  ["method", holder.method],
  ["getter", Object.getOwnPropertyDescriptor(holder, "getter").get],
  ["async function", asyncFunction],
  ["generator function", generatorFunction],
  ["bound closure", closure.bind({ tag: 1 }, 100)],
  ["bound arrow function", arrow.bind(null, 100)],
  ["bound class", Point.bind(null, 100)],
  ["bound function bound again", closure.bind(null, 100).bind(null, 200)],
  ["bound host function", Math.max.bind(null, 100)],
  ["Math.max", Math.max],
  ["parseInt", parseInt],
  ["JSON.stringify", JSON.stringify],
  ["Array", Array],
  ["Object", Object],
  ["String", String],
  ["Symbol", Symbol],
  ["BigInt", BigInt],
  ["Map", Map],
  ["Promise", Promise],
  ["Error", Error],
  ["Function.prototype", Function.prototype],
  ["Function.prototype.call", Function.prototype.call],
  ["proxy without traps", new Proxy(closure, {})],
  ["proxy with traps", new Proxy(closure, { apply(target, receiver, list) { return "applied " + list.join(); }, construct(target, list) { return { constructed: list }; } })],
  ["proxy of a class", new Proxy(Point, {})],
  ["proxy of an arrow function", new Proxy(arrow, {})],
  ["proxy of a proxy", new Proxy(new Proxy(closure, {}), {})],
  ["proxy of an object", new Proxy({}, {})],
  ["revoked proxy", revocable.proxy],
  ["new Function", new Function("a", "b", "return 'text ' + (a + b) + ' ' + typeof this")],
  ["function from eval", (0, eval)("(function (a, b) { if (new.target) this.sum = a + b; else return 'evaluated ' + (a + b); })")],
  ["arrow function from eval", (0, eval)("(a, b) => 'evaluated arrow ' + (a + b)")],
  ["class from eval", (0, eval)("(class Evaluated { constructor(a, b) { this.sum = a + b; } })")],
  ["undefined", undefined],
  ["null", null],
  ["number", 7],
  ["string", "text"],
  ["object", {}],
  ["array", []],
  ["symbol", Symbol("s")],
  ["bigint", 10n],
];
function tryAll(list) {
  return list.map(([name, callee]) => name + ": call " + outcome(() => callIt(callee, 1, 2)) + ", new " + outcome(() => constructIt(callee, 1, 2)));
}
const forward = tryAll(callees);
const backward = tryAll(callees.slice().reverse()).reverse();
lines.push(...forward, "the same in reverse order: " + (forward.join("\n") === backward.join("\n")));
captured = 20;
lines.push("after a store to the captured variable: " + callIt(closure, 1, 2) + ", " + callIt(arrow, 1, 2) + ", " + constructIt(closure, 1, 2).sum);

const thrownValues = [7, 1.5, "text", true, undefined, null, Symbol("thrown"), 10n, { tag: "object" }, [1, 2], closure, new Error("created earlier"), new TypeError("typed")];
const same = (found, value) => (Object.is(found, value) ? "same" : "different " + render(found));
function summarize(name, results) { lines.push(name + ": " + results.filter((result, index) => results.indexOf(result) === index).join(" | ")); }

function thrower(value) { throw value; }
function passThrough(value) { const result = thrower(value); return result + 1; }
function catches(value) { try { return passThrough(value); } catch (error) { return error; } }
function rethrows(value) { try { return passThrough(value); } catch (error) { events.push("rethrow"); throw error; } }
function rethrowsTwice(value) { try { return rethrows(value); } catch (error) { events.push("again"); throw error; } }
function hasFinally(value) { try { return passThrough(value); } finally { events.push("finally"); } }
function hasNestedFinally(value) { try { try { return hasFinally(value); } finally { events.push("inner"); } } finally { events.push("outer"); } }
function catchesAfterFinally(value) { try { return hasNestedFinally(value); } catch (error) { return error; } }
function finallyReturns(value) { try { return passThrough("another"); } finally { return value; } }
function catchThrowsAnother(value) { try { return passThrough("another"); } catch (error) { throw value; } }
function finallyThrowsAnother(value) { try { return passThrough("another"); } finally { throw value; } }
class ThrowsInConstructor { constructor(value) { this.result = passThrough(value); } }
const boundPassThrough = passThrough.bind(null);
const proxiedPassThrough = new Proxy(passThrough, {});
const textCalls = new Function("callee", "value", "var result = callee(value); return result + 1;");
const textCatches = new Function("callee", "value", "try { return callee(value); } catch (error) { return error; }");
const textHasFinally = new Function("callee", "value", "events", "try { return callee(value); } finally { events.push('text finally'); }");
const textThrows = new Function("value", "throw value;");
const paths = [
  ["no handler", passThrough],
  ["catch", catches],
  ["catch and rethrow", rethrows],
  ["rethrown twice", rethrowsTwice],
  ["finally", hasFinally],
  ["nested finally", hasNestedFinally],
  ["catch above finally", catchesAfterFinally],
  ["finally that returns", finallyReturns],
  ["catch that throws another value", catchThrowsAnother],
  ["finally that throws another value", finallyThrowsAnother],
  ["through the call site", value => callIt(passThrough, value, 0) + 1],
  ["through the construct site", value => constructIt(ThrowsInConstructor, value, 0)],
  ["through Array.prototype.map", value => [value].map(hasFinally)[0]],
  ["through Reflect.apply", value => Reflect.apply(hasFinally, undefined, [value])],
  ["through a bound function", value => boundPassThrough(value) + 1],
  ["through a proxy", value => proxiedPassThrough(value) + 1],
  ["through a getter", value => ({ get property() { return passThrough(value); } }).property],
  ["through evaluated text", value => textCalls(hasFinally, value)],
  ["caught by evaluated text", value => textCatches(hasFinally, value)],
  ["finally in evaluated text", value => textHasFinally(rethrows, value, events)],
  ["thrown by evaluated text", value => { try { return textThrows(value); } catch (error) { return error; } }],
  ["thrown by evaluated text through finally", value => { try { return textThrows(value); } finally { events.push("finally"); } }],
];
for (const [name, path] of paths) {
  summarize(name, thrownValues.map(value => {
    try {
      return "returned " + same(path(value), value) + takeEvents();
    } catch (error) {
      return "threw " + same(error, value) + takeEvents();
    }
  }));
}

function names(error) {
  return String(error.stack).split("\n").map(line => /^(?:\s*at (?:async )?)?([A-Za-z]\w*)[ @(]/.exec(line)?.[1]).filter(Boolean).slice(0, 3).join(" < ");
}
function fail(message) { throw new Error(message); }
function failThrough(message) { const result = fail(message); return result + 1; }
function catchesError(message, readsStack) { try { return failThrough(message); } catch (error) { if (readsStack) events.push(names(error)); return error; } }
function rethrowsError(message, readsStack) { try { return failThrough(message); } catch (error) { if (readsStack) events.push(names(error)); throw error; } }
function finallyAroundError(message) { try { return failThrough(message); } finally { events.push("finally"); } }
function rethrowsAboveFinally(message, readsStack) { try { return finallyAroundError(message); } catch (error) { if (readsStack) events.push(names(error)); throw error; } }
for (const [name, path] of [["error caught", catchesError], ["error rethrown", rethrowsError], ["error through finally", finallyAroundError], ["error rethrown above finally", rethrowsAboveFinally]]) {
  for (const readsStack of [false, true]) {
    let error;
    try {
      error = path(name, readsStack);
    } catch (thrown) {
      error = thrown;
    }
    lines.push(name + ": " + error.constructor.name + " " + error.message + takeEvents() + (readsStack ? " " + names(error) + " " + typeof error.stack : " stack not read") + " " + Object.keys(error).length);
  }
}

function* generatorThrows(value) { yield "first"; passThrough(value); yield "unreachable"; }
function* generatorHasFinally(value) { try { yield "first"; passThrough(value); } finally { events.push("generator finally"); } }
function* generatorCatches(value) { try { yield "first"; passThrough(value); } catch (error) { yield error; } }
function* generatorRethrows(value) { try { yield "first"; hasFinally(value); } catch (error) { events.push("rethrow"); throw error; } }
function* generatorDelegates(value) { yield* generatorHasFinally(value); }
function* generatorWaits() { try { yield "first"; } catch (error) { yield error; } }
function* generatorWaitsInFinally() { try { yield "first"; } finally { events.push("generator finally"); } }
function stepThrough(generator, value, resume) {
  const steps = [generator.next().value];
  try {
    steps.push("yielded " + same(resume(generator).value, value));
  } catch (error) {
    steps.push("threw " + same(error, value));
  }
  steps.push("done " + generator.next().done);
  return steps.join(", ") + takeEvents();
}
for (const [name, create] of [["generator throws", generatorThrows], ["generator with finally", generatorHasFinally], ["generator catches", generatorCatches], ["generator rethrows", generatorRethrows], ["generator delegates", generatorDelegates]])
  summarize(name, thrownValues.map(value => stepThrough(create(value), value, generator => generator.next())));
for (const [name, create] of [["throw into a generator that catches", generatorWaits], ["throw into a generator with finally", generatorWaitsInFinally]])
  summarize(name, thrownValues.map(value => stepThrough(create(), value, generator => generator.throw(value))));

async function asyncThrowsAtOnce(value) { return passThrough(value); }
async function asyncThrowsLater(value) { await null; return passThrough(value); }
async function asyncCatches(value) { try { return await asyncThrowsLater(value); } catch (error) { return error; } }
async function asyncRethrows(value) { try { return await asyncThrowsAtOnce(value); } catch (error) { events.push("rethrow"); throw error; } }
async function asyncHasFinally(value) { try { return await asyncThrowsLater(value); } finally { events.push("async finally"); } }
async function asyncCallsFinally(value) { await null; return hasNestedFinally(value); }
async function asyncAwaitsRejection(value) { return await Promise.reject(value); }
async function* asyncGeneratorThrows(value) { yield "first"; await null; passThrough(value); }
async function asyncIterates(value) { for await (const step of asyncGeneratorThrows(value)) events.push(step); }
const asyncPaths = [
  ["async function throws at once", asyncThrowsAtOnce],
  ["async function throws after await", asyncThrowsLater],
  ["async function catches", asyncCatches],
  ["async function rethrows", asyncRethrows],
  ["async function with finally", asyncHasFinally],
  ["finally under a resumed async function", asyncCallsFinally],
  ["await of a rejected promise", asyncAwaitsRejection],
  ["async generator throws", asyncIterates],
];

let deepest = 0, unwound = 0;
function recurse(n) { deepest = n; return recurse(n + 1) + 1; }
function recurseThroughCallSite(n) { deepest = n; return callIt(recurseThroughCallSite, n + 1, 0) + 1; }
function RecurseThroughConstructSite(n) { deepest = n; this.child = constructIt(RecurseThroughConstructSite, n + 1, 0); }
function recurseThroughBoundFunction(n) { deepest = n; return boundRecursion(n + 1) + 1; }
const boundRecursion = recurseThroughBoundFunction.bind(null);
function recurseThroughProxy(n) { deepest = n; return proxiedRecursion(n + 1) + 1; }
const proxiedRecursion = new Proxy(recurseThroughProxy, {});
function recurseThroughHostFunction(n) { deepest = n; return [n + 1].map(recurseThroughHostFunction)[0] + 1; }
function recurseThroughText(n) { deepest = n; return textCalls(recurseThroughText, n + 1) + 1; }
function recurseWithFinally(n) { deepest = n; try { return recurseWithFinally(n + 1) + 1; } finally { unwound++; } }
function countDown(n) { return n === 0 ? 0 : countDown(n - 1) + 1; }
const recursions = [
  ["direct recursion", () => recurse(0)],
  ["recursion through the call site", () => recurseThroughCallSite(0)],
  ["recursion through the construct site", () => new RecurseThroughConstructSite(0)],
  ["recursion through a bound function", () => recurseThroughBoundFunction(0)],
  ["recursion through a proxy", () => recurseThroughProxy(0)],
  ["recursion through a host function", () => recurseThroughHostFunction(0)],
  ["recursion through evaluated text", () => recurseThroughText(0)],
  ["recursion with finally", () => recurseWithFinally(0)],
];

async function main() {
  for (const [name, path] of asyncPaths) {
    const results = [];
    for (const value of thrownValues) {
      try {
        results.push("resolved " + same(await path(value), value) + takeEvents());
      } catch (error) {
        results.push("rejected " + same(error, value) + takeEvents());
      }
    }
    summarize(name, results);
  }
  for (let round = 0; round < 2; round++) {
    for (const [name, run] of recursions) {
      deepest = 0;
      lines.push(name + ": " + outcome(run) + ", went deep: " + (deepest > 100));
    }
    lines.push("every finally ran: " + (unwound === deepest + 1) + ", recursion that ends: " + countDown(1000));
    unwound = 0;
  }
  console.log(lines.join("\n"));
}
main();
