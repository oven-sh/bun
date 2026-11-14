// The frames that traces list where an async function is called in tail position by a copied function, and where `for await` steps lists and async generators.
function frames(stack) { return stack.split("\n").slice(1).map(l => l.trim().replace(/\(?[^ (]*[\\/]([^\\/]+?)\)?$/, "$1")).join(" | "); }
function seen(label) { console.log(label, frames(new Error("seen").stack)); }
const thenable = { get then() { seen("then"); return undefined; } };
function sync() { seen("sync"); return 1; }
function syncCalls() { const result = sync(); return result; }
function syncCallsTwice() { const result = sync(); seen("between"); return result; }
async function awaitsAtOnce() { await thenable; }
async function logsFirst() { seen("in"); await thenable; }
function calls() { const promise = awaitsAtOnce(); return promise; }
function callsLogs() { const promise = logsFirst(); return promise; }
function callsDirect() { return awaitsAtOnce(); }
function callsKept() { const promise = awaitsAtOnce(); promise.kept = 1; return promise; }
async function walks(wait) { await wait; for await (const each of [thenable]) seen("body"); }
async function walksFirst() { for await (const each of [thenable]) seen("body"); }
async function* gives(wait) { await wait; yield thenable; }
async function walksGenerator(wait) { await wait; for await (const each of gives(null)) seen("body"); }
async function walksSync(wait) { await wait; for await (const each of (function* () { seen("step"); yield thenable; })()) seen("body"); }
async function* starts() { seen("starts"); yield 1; seen("second"); yield 2; seen("end"); }
async function* startsLater() { await null; seen("starts"); yield 1; seen("second"); }
async function walksStarts(wait) { await wait; for await (const each of starts()) seen("body"); }
async function walksLater(wait) { await wait; for await (const each of startsLater()) seen("body"); }
async function walksStartsFirst() { for await (const each of starts()) seen("body"); }
const own = { [Symbol.asyncIterator]() { seen("open"); let k = 0; return { next() { seen("next"); return { done: k++ > 1, get value() { seen("value"); return 1; } }; }, return() { seen("return"); return {}; } }; } };
async function walksOwn(wait) { await wait; for await (const each of own) { seen("body"); break; } }
const ownThen = { [Symbol.asyncIterator]() { let k = 0; return { next() { return k++ ? { done: true } : thenable; } }; } };
async function walksThen(wait) { await wait; try { for await (const each of ownThen) seen("body"); } catch (e) { seen("caught"); } }
async function walksList(wait) { await wait; for await (const each of [thenable, 1, thenable]) seen("body"); }
async function walksPromises() { for await (const each of [Promise.resolve(1), thenable]) seen("body"); }
async function calledBy(f) { await null; await f(null); }
async function direct() { await null; await walksList(null); }
syncCalls();
syncCallsTwice();
console.log("calls"); await calls();
console.log("logs"); await callsLogs();
console.log("direct"); await callsDirect();
console.log("kept"); await callsKept();
console.log("walks"); await walks(null);
console.log("first"); await walksFirst();
console.log("generator"); await walksGenerator(null);
console.log("sync"); await walksSync(null);
for (const f of [walksStarts, walksLater, walksStartsFirst, walksOwn, walksThen, walksList, walksPromises]) { console.log(f.name); await f(null); }
for (const f of [walksStarts, walksList]) { console.log("by", f.name); await calledBy(f); }
await direct();
