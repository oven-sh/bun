// An object or a closure that never leaves its function may live in the frame. Each case hands one to a function that is not inlined and does one thing with it while the collector runs: keeps it in a cell that dies with the call, captures it, returns it, throws it, passes it on, hands it to a built-in, reads it under a computed key, fills it.
const collect = () => Bun.gc(true);
const rounds = 40;

function report(title, run) {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum += run(i);
  console.log(title, sum);
}

function holdsInArray(text, point) { const held = [5, point, text]; collect(); return held.length + held[1].y; }
function guardsHoldsInArray(text, point) { try { return holdsInArray(text, point); } catch {} }
report("held in an array", i => guardsHoldsInArray("text", { y: i }));

function holdsInRecord(text, point) { const held = { point, text }; collect(); return held.point.y; }
function guardsHoldsInRecord(text, point) { try { return holdsInRecord(text, point); } catch {} }
report("held in a record", i => guardsHoldsInRecord("text", { y: i }));

function storesInField(point) { const held = { point: null }; held.point = point; collect(); return held.point.y; }
function guardsStoresInField(point) { try { return storesInField(point); } catch {} }
report("stored in a field", i => guardsStoresInField({ y: i }));

function storesInElement(point) { const held = [0]; held[0] = point; collect(); return held[0].y; }
function guardsStoresInElement(point) { try { return storesInElement(point); } catch {} }
report("stored in an element", i => guardsStoresInElement({ y: i }));

function pushes(point) { const held = []; held.push(point); collect(); return held[0].y; }
function guardsPushes(point) { try { return pushes(point); } catch {} }
report("pushed", i => guardsPushes({ y: i }));

function callsDuringCollection(callback) { try { collect(); return callback(); } catch {} }
function captures(point) { return callsDuringCollection(() => point.y); }
function guardsCaptures(point) { try { return captures(point); } catch {} }
report("captured by a closure of the callee", i => guardsCaptures({ y: i }));

function makesReader(point) { return () => point.y; }
function guardsMakesReader(point) { try { return makesReader(point); } catch {} }
report("captured by a closure that is returned", i => { const read = guardsMakesReader({ y: i }); collect(); return read(); });

function returnsIt(point) { return point; }
function guardsReturnsIt(point) { try { return returnsIt(point); } catch {} }
report("returned", i => { const point = guardsReturnsIt({ y: i }); collect(); return point.y; });

function throwsIt(point) { throw point; }
function cleansUp(point) { try { throwsIt(point); } finally { collect(); } }
report("thrown", i => { try { cleansUp({ y: i }); } catch (point) { collect(); return point.y; } });

let kept;
function keeps(point) { kept = point; }
function guardsKeeps(point) { try { keeps(point); } catch {} }
report("kept in a variable", i => { guardsKeeps({ y: i }); collect(); return kept.y; });

function passesOn(point) { try { return holdsInArray("text", point); } catch {} }
function guardsPassesOn(point) { try { return passesOn(point); } catch {} }
report("held two calls down", i => guardsPassesOn({ y: i }));

function takesRest(...points) { collect(); return points.length + points[0].y; }
function guardsTakesRest(point) { try { return takesRest(point, 1); } catch {} }
report("taken by a rest parameter", i => guardsTakesRest({ y: i }));

function readsArguments() { collect(); return arguments.length + arguments[0].y; }
function guardsReadsArguments(point) { try { return readsArguments(point, 1); } catch {} }
report("read from the arguments object", i => guardsReadsArguments({ y: i }));

function* yields(point) { yield point.y; collect(); yield point.y; }
function guardsYields(point) { try { return yields(point); } catch {} }
report("held by a generator", i => { const steps = guardsYields({ y: i }); collect(); return steps.next().value + steps.next().value; });

function links(holder, point) { holder.next = point; }
function guardsLinks(holder, point) { try { links(holder, point); } catch {} }
report("stored in another argument", i => { const holder = { next: null }; guardsLinks(holder, { y: i }); collect(); return holder.next.y; });

const longLived = { next: null };
report("stored in an object that lives on", i => { guardsLinks(longLived, { y: i }); collect(); return longLived.next.y; });

function listsKeys(point) { collect(); return Object.keys(point).length; }
function guardsListsKeys(point) { try { return listsKeys(point); } catch {} }
report("keys listed by a built-in", i => guardsListsKeys({ y: i, z: 2 }));

function writesText(point) { return JSON.stringify(point).length; }
function guardsWritesText(point) { try { return writesText(point); } catch {} }
report("written as text by a built-in", i => guardsWritesText({ y: i, z: { w: [i, [i, [i, [i, [i, [i, [i, [i, [i, [i]]]]]]]]]] } }));

class Point { constructor(y) { this.y = y; } holdsItself() { const held = [this]; collect(); return held[0].y; } }
function asksForPrototype(point) { collect(); return Object.getPrototypeOf(point) === Point.prototype ? point.y : -1; }
function guardsAsksForPrototype(point) { try { return asksForPrototype(point); } catch {} }
report("asked for its prototype", i => guardsAsksForPrototype(new Point(i)));

function guardsHoldsItself(point) { try { return point.holdsItself(); } catch {} }
report("held by its own method", i => guardsHoldsItself(new Point(i)));

function usesAsKey(point) { const map = new Map(); map.set(point, 1); collect(); return map.get(point) + map.size; }
function guardsUsesAsKey(point) { try { return usesAsKey(point); } catch {} }
report("used as the key of a map", i => guardsUsesAsKey({ y: i }));

function readsByKey(point, key) { collect(); return point[key]; }
function guardsReadsByKey(point, key) { try { return readsByKey(point, key); } catch {} }
report("read under a computed key", i => guardsReadsByKey({ y: i, z: 2 }, i & 1 ? "y" : "z"));

function namesIn(point) { let names = ""; for (const name in point) { collect(); names += name; } return names.length; }
function guardsNamesIn(point) { try { return namesIn(point); } catch {} }
report("enumerated", i => guardsNamesIn({ y: i, z: 1 }));

function copies(point) { const copy = { ...point }; collect(); return copy.y + copy.z.w; }
function guardsCopies(point) { try { return copies(point); } catch {} }
report("spread into a copy", i => guardsCopies({ y: i, z: { w: 1 } }));

function concatenates(point) { return ("" + point).length; }
function guardsConcatenates(point) { try { return concatenates(point); } catch {} }
report("converted to a string", i => guardsConcatenates({ y: i }));

function looksAt(point, other) { collect(); return (point instanceof Point) + (typeof point).length + ("y" in point) + (point === other) + (point == other) + (point !== null) + !point; }
function guardsLooksAt(point, other) { try { return looksAt(point, other); } catch {} }
report("looked at by operators", i => { const point = new Point(i); return guardsLooksAt(point, point) + guardsLooksAt({ y: i }, point); });

function fills(point, i) { point.y = { z: i }; }
function guardsFills(point, i) { try { fills(point, i); } catch {} }
report("filled by the callee", i => { const point = { y: null }; guardsFills(point, i); collect(); return point.y.z; });

function readsDuringCollection(point) { collect(); return point.y.z; }
function guardsReadsDuringCollection(point) { try { return readsDuringCollection(point); } catch {} }
report("keeps a young object alive", i => { const point = { y: { z: i } }; const first = guardsReadsDuringCollection(point); collect(); return first + point.y.z; });

function guardsCallsDuringCollection(callback) { try { return callsDuringCollection(callback); } catch {} }
report("a closure called during a collection", i => { const state = { value: i }; let calls = 0; return guardsCallsDuringCollection(() => { calls++; return state.value; }) + calls; });

function countsMatches(node, test) { if (node === undefined) return 0; return (test(node) ? 1 : 0) + countsMatches(node.next, test); }
report("handed on by the part of a function that needs no frame", i => countsMatches({ id: i, next: { id: i + 1, next: undefined } }, node => { collect(); return node.id > 20; }));

function revives(text, reviver) { return JSON.parse(text, reviver); }
function guardsRevives(text, reviver) { try { return revives(text, reviver); } catch {} }
report("a closure called by a built-in", i => { let calls = 0; guardsRevives('{"a":1,"b":[2,3]}', (key, value) => { calls += i; return value; }); return calls; });

function sorts(numbers, compare) { return numbers.sort(compare)[0]; }
function guardsSorts(numbers, compare) { try { return sorts(numbers, compare); } catch {} }
report("a closure handed to a sort", i => { let calls = 0; return guardsSorts([3, 1, i], (a, b) => { calls++; collect(); return a - b; }) + (calls > 0); });

let awaited = 0;
async function waits(point) { await null; collect(); awaited += point.y; }
function guardsWaits(point) { try { return waits(point); } catch {} }
for (let i = 0; i < rounds; i++) guardsWaits({ y: i });
collect();
await null;
await new Promise(resolve => setTimeout(resolve, 0));
console.log("held by an async function", awaited);

function runs(use, change) { try { use(change); } catch { return "threw"; } return "ran"; }
function changesNothing() {}
function checks(use, getTarget, change) {
  let result;
  const changesThroughAlias = () => { for (const alias of [{}, function () {}, getTarget()]) result = change(alias); };
  return runs(use, changesNothing) + " " + runs(use, changesThroughAlias) + " " + result;
}
const target = { m: 0 };
function usesFirst(change) { for (let i = 0; i < 300; i++) if (i === 150) { collect(); change(); collect(); } }
function usesSecond(change) { for (let i = 0; i < 300; i++) if (i === 151) { collect(); change(); collect(); } }
function usesThird(change) { for (let i = 0; i < 300; i++) if (i === 152) { collect(); change(); collect(); } }
function usesFourth(change) { for (let i = 0; i < 300; i++) if (i === 153) { collect(); change(); collect(); } }
function usesFifth(change) { for (let i = 0; i < 300; i++) if (i === 154) { collect(); change(); collect(); } }
console.log("closures captured by a closure of the callee", checks(usesFirst, () => target, alias => { alias.m = 1; return 1; }));
console.log("closures captured by a closure of the callee", checks(usesSecond, () => target, alias => { alias.m = 2; return 2; }));
console.log("closures captured by a closure of the callee", checks(usesThird, () => target, alias => { alias.m = 3; return 3; }));
console.log("closures captured by a closure of the callee", checks(usesFourth, () => target, alias => { alias.m = 4; return 4; }));
console.log("closures captured by a closure of the callee", checks(usesFifth, () => target, alias => { alias.m = 5; return 5; }));
