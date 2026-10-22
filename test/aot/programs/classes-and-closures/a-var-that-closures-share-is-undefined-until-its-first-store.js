// A `var` that closures share holds undefined until its first store. Each function below has a closure that may or may not run in front of that store; every line is what plain Bun prints.
const out = [];
function show(name, value) { out.push(name + ": " + (typeof value === "object" && value !== null ? JSON.stringify(value) : String(value))); }

function storedFirst() { var table = { x: 1 }; function read() { return table.x; } return read; }
show("stored first", storedFirst()());

function hoistedCallInFront() { var seen = read(); var table = { x: 1 }; function read() { return table; } return [seen, read()]; }
show("a hoisted function is called in front of the store", hoistedCallInFront());

function handedOutInFront(take) { take(() => table); var table = { x: 2 }; return () => table; }
let early;
const late = handedOutInFront(f => { early = f(); });
show("a closure is handed out and called in front of the store", [early, late()]);

function keptAndCalledLater(keep) { keep(() => table); var table = { x: 3 }; }
let kept;
keptAndCalledLater(f => { kept = f; });
show("a closure is kept in front of the store and called behind it", kept());

function storeOnOnePath(flag) { if (flag) var table = { x: 4 }; return () => table; }
show("the store stands on one path", [storeOnOnePath(true)(), storeOnOnePath(false)()]);

function storeInTry(fail) { try { var table = fail(); } catch { } return () => table; }
show("the store is left out by a throw", [storeInTry(() => ({ x: 5 }))(), storeInTry(() => { throw new Error("no"); })()]);

function storeInLoop(rounds) { const readers = []; for (let i = 0; i < rounds; i++) { var last = { x: i }; readers.push(() => last.x); } readers.push(() => last); return readers; }
show("the store stands in a loop", [storeInLoop(3).map(f => f()), storeInLoop(0).map(f => f())]);

function closureInOwnInitializer() { var self = (() => () => self)(); return self; }
const own = closureInOwnInitializer();
show("a closure in its own initializer", own() === own);

function initializerReadsItself() { var value = (() => value)(); return () => value; }
show("the initializer reads the binding", initializerReadsItself()());

function declaredTwice() { var table = { x: 6 }; const first = () => table; var table; return [first(), (() => table)()]; }
show("declared twice", declaredTwice());

function storedUndefined() { var table = { x: 7 }; const read = () => table; const before = read(); table = undefined; return [before, read()]; }
show("undefined is stored later", storedUndefined());

function storedUndefinedFirst(pick) { var table = pick ? { x: 8 } : undefined; return () => table; }
show("undefined is what the first store brings", [storedUndefinedFirst(true)(), storedUndefinedFirst(false)()]);

function withoutInitializer() { var table; const read = () => table; const before = read(); table = { x: 9 }; return [before, read()]; }
show("no initializer", withoutInitializer());

function getterInFront() { const holder = { get now() { return table; } }; const before = holder.now; var table = { x: 10 }; return [before, holder.now]; }
show("a getter runs in front of the store", getterInFront());

function defaultParameter(read = () => table) { var table = { x: 11 }; let answer; try { answer = read(); } catch (error) { answer = error.name; } return answer; }
show("a default parameter names another binding", defaultParameter());

function* generator() { const read = () => table; yield read(); var table = { x: 12 }; yield read(); }
show("a generator stops in front of the store", [...generator()]);

async function asynchronous(results) { const read = () => table; results.push(read()); await null; var table = { x: 13 }; results.push(read()); }
const awaited = [];
await asynchronous(awaited);
show("an async function waits in front of the store", awaited);

function labeled(skip) { block: { if (skip) break block; var table = { x: 14 }; } return () => table; }
show("a break leaves in front of the store", [labeled(false)(), labeled(true)()]);

function entersAgain(depth) { var mine = { x: depth }; const read = () => mine.x; return depth ? [read(), ...entersAgain(depth - 1), read()] : [read()]; }
show("each activation has its own", entersAgain(2));

function number() { var count = 0; var step = 2; function next() { count += step; return count; } return next; }
const next = number();
show("numbers", [next(), next(), next()]);

function typeofInFront() { const kind = () => typeof table; const before = kind(); var table = "text"; return [before, kind()]; }
show("typeof in front of the store", typeofInFront());

console.log(out.join("\n"));
