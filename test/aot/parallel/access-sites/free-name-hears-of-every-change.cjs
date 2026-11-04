// A free name is looked for among the bindings of scripts and then on the global object and above it. What a read has found is remembered, and every way in which the answer can move ends that.
const vm = require("node:vm");
const attempt = f => { try { return f(); } catch (error) { return error.constructor.name + ": " + error.message; } };
function readCounter() { return counter; }
function typeOfCounter() { return typeof counter; }
function readLater() { return later; }
function typeOfLater() { return typeof later; }
function readAccessor() { return accessor; }
function callHelper(x) { return helper(x); }
const warm = f => { let last; for (let i = 0; i < 300; i++) last = attempt(f); return last; };
// Nothing has the name: the read throws each time, and typeof answers.
console.log(warm(readLater), warm(typeOfLater));
globalThis.later = 1; console.log(warm(readLater), warm(typeOfLater));
// A value on the global object: stored by name, through globalThis, by defineProperty, deleted, made again.
globalThis.counter = 1; console.log(warm(readCounter), warm(typeOfCounter));
counter = 2; console.log(readCounter()); globalThis.counter = 3; console.log(readCounter());
for (let i = 0; i < 300; i++) { counter = i; if (readCounter() !== i) console.log("wrong", i); }
Object.defineProperty(globalThis, "counter", { value: "defined", writable: true, configurable: true }); console.log(readCounter(), typeOfCounter());
Object.defineProperty(globalThis, "counter", { get() { return "getter"; }, configurable: true }); console.log(warm(readCounter), typeOfCounter());
delete globalThis.counter; console.log(attempt(readCounter), typeOfCounter());
globalThis.counter = "again"; console.log(warm(readCounter));
Reflect.set(globalThis, "counter", "by Reflect"); console.log(readCounter());
Object.assign(globalThis, { counter: "by assign" }); console.log(readCounter());
// A binding of a script hides the property, also one that is still in its dead zone.
vm.runInThisContext("let counter = 'of a script';"); console.log(warm(readCounter), typeOfCounter(), globalThis.counter);
vm.runInThisContext("counter = 'stored by a script';"); console.log(readCounter());
console.log(attempt(() => vm.runInThisContext("later; let later = 5;")), attempt(readLater), attempt(typeOfLater));
// An accessor that counts its calls.
let calls = 0; Object.defineProperty(globalThis, "accessor", { get() { return ++calls; }, configurable: true }); console.log(warm(readAccessor), calls);
// A function that is replaced.
globalThis.helper = x => x + 1; console.log(warm(() => callHelper(1))); globalThis.helper = x => x * 10; console.log(callHelper(1)); helper = x => "third " + x; console.log(callHelper(1));
// Names of the engine.
function readUndefined() { return undefined; } function readMath() { return Math; } function readArray() { return Array; }
console.log(warm(readUndefined), warm(readMath) === Math, warm(readArray) === Array);
// Cells that the global object alone keeps alive.
globalThis.counterCell = { n: 1 }; function readCell() { return counterCell; } console.log(warm(readCell).n); globalThis.counterCell = { n: 2 }; Bun.gc(true); console.log(readCell().n);
