// A symbol comes out of an async function, a generator, a try statement and calls of Symbol that are not written as plain calls, and a built-in stores it.
function show(label, value) {
  console.log(label, typeof value === "symbol" ? String(value) : value);
}

async function makeLater() { return Symbol("later"); }
function* makeByGenerator() { return Symbol("generated"); }
function* yieldOne() { yield Symbol("yielded"); }
async function makeAfterAwait() { await null; return Symbol("awaited"); }
function makeInTry() { try { return Symbol("tried"); } finally { show("finally", "ran"); } }
function makeInFinally() { try { throw 1; } catch { return Symbol("caught"); } }
function makeByComma() { return (0, Symbol)("comma"); }
function makeByCall() { return Symbol.call(undefined, "call"); }
function makeByApply() { return Symbol.apply(undefined, ["apply"]); }
function makeBySpread() { return Symbol(...["spread"]); }
function makeByReflect() { return Reflect.apply(Symbol, undefined, ["reflect"]); }
function makeWithObject() { return Symbol({ toString() { show("description", "converted"); return "object"; } }); }
function makeWithNumber() { return Symbol(5); }
function makeWithUndefined() { return Symbol(undefined); }

function define(value) {
  const holder = {};
  Object.defineProperty(holder, "pet", { value, writable: true, enumerable: true, configurable: true });
  return holder;
}

const later = await makeLater();
show("later", define(later).pet);
show("later legs", define(later).pet.legs);
const generated = makeByGenerator().next().value;
show("generated", generated);
const holdsGenerated = {};
Reflect.set(holdsGenerated, "pet", generated);
show("generated legs", holdsGenerated.pet.legs);
const yielded = yieldOne().next().value;
const holdsYielded = {};
Reflect.set(holdsYielded, "pet", yielded);
show("yielded", holdsYielded.pet);
const awaited = await makeAfterAwait();
const holdsAwaited = {};
Reflect.set(holdsAwaited, "pet", awaited);
show("awaited", holdsAwaited.pet.description);

for (const make of [makeInTry, makeInFinally, makeByComma, makeByCall, makeByApply, makeBySpread, makeByReflect, makeWithObject, makeWithNumber, makeWithUndefined]) {
  const value = make();
  const holder = {};
  Object.defineProperty(holder, "pet", { value, writable: true, enumerable: true, configurable: true });
  show(make.name, holder.pet);
  show(make.name + " is it", holder.pet === value);
}

const tried = {};
Reflect.set(tried, "pet", makeInTry());
show("tried legs", tried.pet.legs);
const comma = {};
Reflect.set(comma, "pet", makeByComma());
show("comma legs", comma.pet.legs);
const called = {};
Reflect.set(called, "pet", makeByCall());
show("called legs", called.pet.legs);
const withObject = {};
Reflect.set(withObject, "pet", makeWithObject());
show("object legs", withObject.pet.legs);
