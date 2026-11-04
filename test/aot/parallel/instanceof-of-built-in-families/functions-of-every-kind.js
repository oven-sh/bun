const report = value => console.log(typeof value === "string" ? value : String(value));
// Generated: classes that share a prototype object, a kind of cell or a row of classes, each asked about the values of all.
const show = (value) => value === true ? "1" : value === false ? "0" : String(value);
function attempt(act) { try { return act(); } catch (error) { return "T"; } }
function maybe(name, make, values) { try { values.push([name, make()]); } catch (error) { values.push([name + ", which cannot be made: " + error.name, undefined]); } }

function isFunction(x) { return x instanceof Function; }
function countFunction(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Function) count++; } return count; }
function isObject(x) { return x instanceof Object; }
function countObject(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Object) count++; } return count; }
function isPromise(x) { return x instanceof Promise; }
function countPromise(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Promise) count++; } return count; }
const tests = [["Function", isFunction, countFunction], ["Object", isObject, countObject], ["Promise", isPromise, countPromise]];
const values = [];
maybe("created below Function.prototype", () => Object.create(Function.prototype), values);
maybe("Function.prototype", () => Function.prototype, values);
maybe("Function", () => Function, values);
maybe("new Function", () => new Function(), values);
maybe("new of a class below Function", () => new (class extends Function {})(), values);
maybe("new Function without its prototype", () => Object.setPrototypeOf(new Function(), null), values);
maybe("new Function below Object.prototype", () => Object.setPrototypeOf(new Function(), Object.prototype), values);
maybe("a proxy of new Function", () => new Proxy(new Function(), {}), values);
maybe("Function made for Object as new.target", () => Reflect.construct(Function, [], Object), values);
maybe("created below Object.prototype", () => Object.create(Object.prototype), values);
maybe("Object.prototype", () => Object.prototype, values);
maybe("Object", () => Object, values);
maybe("new Object", () => new Object(), values);
maybe("new of a class below Object", () => new (class extends Object {})(), values);
maybe("new Object without its prototype", () => Object.setPrototypeOf(new Object(), null), values);
maybe("new Object below Promise.prototype", () => Object.setPrototypeOf(new Object(), Promise.prototype), values);
maybe("a proxy of new Object", () => new Proxy(new Object(), {}), values);
maybe("Object made for Promise as new.target", () => Reflect.construct(Object, [], Promise), values);
maybe("created below Promise.prototype", () => Object.create(Promise.prototype), values);
maybe("Promise.prototype", () => Promise.prototype, values);
maybe("Promise", () => Promise, values);
maybe("new Promise", () => new Promise(() => {}), values);
maybe("new of a class below Promise", () => new (class extends Promise {})(() => {}), values);
maybe("new Promise without its prototype", () => Object.setPrototypeOf(new Promise(() => {}), null), values);
maybe("new Promise below Function.prototype", () => Object.setPrototypeOf(new Promise(() => {}), Function.prototype), values);
maybe("a proxy of new Promise", () => new Proxy(new Promise(() => {}), {}), values);
maybe("Promise made for Function as new.target", () => Reflect.construct(Promise, [() => {}], Function), values);
maybe("function () {}", () => (function () {}), values);
maybe("() => {}", () => (() => {}), values);
maybe("async function () {}", () => (async function () {}), values);
maybe("async () => {}", () => (async () => {}), values);
maybe("function* () {}", () => (function* () {}), values);
maybe("async function* () {}", () => (async function* () {}), values);
maybe("class {}", () => (class {}), values);
maybe("class extends Map {}", () => (class extends Map {}), values);
maybe("(function () {}).bind(null)", () => ((function () {}).bind(null)), values);
maybe("Map", () => (Map), values);
maybe("Map.bind(null)", () => (Map.bind(null)), values);
maybe("Math.max", () => (Math.max), values);
maybe("new Proxy(function () {}, {})", () => (new Proxy(function () {}, {})), values);
maybe("new Proxy(class {}, {})", () => (new Proxy(class {}, {})), values);
maybe("(async () => {})()", () => ((async () => {})()), values);
maybe("(function* () {})()", () => ((function* () {})()), values);
maybe("(async function* () {})()", () => ((async function* () {})()), values);
maybe("Object.getPrototypeOf(async function () {})", () => (Object.getPrototypeOf(async function () {})), values);
maybe("Object.getPrototypeOf(function* () {})", () => (Object.getPrototypeOf(function* () {})), values);
maybe("Function.prototype", () => (Function.prototype), values);
maybe("Object.prototype", () => (Object.prototype), values);
maybe("Object.create(null)", () => (Object.create(null)), values);
maybe("({ then() {} })", () => (({ then() {} })), values);
maybe("Promise.resolve(1)", () => (Promise.resolve(1)), values);
maybe("Promise.prototype", () => (Promise.prototype), values);
for (const [name, value] of values) {
  let answers = "";
  for (const [, is, count] of tests) answers += show(attempt(() => is(value))) + show(attempt(() => count(value)));
  report(answers + " " + name);
}
const ordinary = Function.prototype[Symbol.hasInstance];
report("Function: " + (Function[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Function, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Function, value))) + show(attempt(() => Function[Symbol.hasInstance](value)))).join(""));
report("Object: " + (Object[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Object, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Object, value))) + show(attempt(() => Object[Symbol.hasInstance](value)))).join(""));
report("Promise: " + (Promise[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Promise, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Promise, value))) + show(attempt(() => Promise[Symbol.hasInstance](value)))).join(""));
process.exit(0);
