// `list.push(f())`: push is read before f runs. Where list is then an array as the engine makes them, what is read is the engine's push, and the call appends, whatever f has done to the array in between.
// CALLS+ pushes GetArrayPushByName
// CALLS+ pushes ArrayPushReadAheadOrCallValue
// CALLS- pushes GetByIdWithDirectColumn
// CALLS+ pushesAtTheEnd ArrayPushReadAheadOrCallValue
// CALLS- pushesTwo ArrayPushReadAhead
// CALLS- keepsPush ArrayPushReadAhead
const functions = [
  function pushes(list, value) { const length = list.push(value()); return length; },
  function pushesAtTheEnd(list, value) { return list.push(value()); },
  function pushesTwo(list, value) { const length = list.push(value(), 2); return length; },
  function keepsPush(list, value) { const push = list.push; const length = push.call(list, value()); return [length, push === list.push]; },
  function pushesInALoop(list, value) { let length = 0; for (let i = 0; i < 3; i++) length = list.push(value()); return length; },
];
const [pushes, pushesAtTheEnd, pushesTwo, keepsPush, pushesInALoop] = functions.map((f, i) => (...all) => functions[i](...all));
function attempt(run) {
  try {
    return String(run());
  } catch (error) {
    return error.constructor.name;
  }
}
function show(list) {
  return JSON.stringify(Array.isArray(list) ? Array.from(list, x => (x === undefined ? "undefined" : typeof x === "object" ? "object" : x)) : Object.entries(list)) + " " + list.length;
}
class Heir extends Array {}
class LoudHeir extends Array { push(value) { return "loud " + super.push(value); } }
const makers = {
  empty: () => [],
  integers: () => [1, 2, 3],
  doubles: () => [0.5, 1.5],
  values: () => ["a", {}, 1],
  holes: () => [1, , 3],
  sparse: () => { const a = [1]; a[100000] = 2; return a; },
  long: () => Array.from({ length: 70 }, (_, i) => i),
  withProperty: () => Object.assign([1], { extra: 1 }),
  ownPush: () => Object.assign([1], { push: v => "own " + v }),
  frozen: () => Object.freeze([1]),
  sealed: () => Object.seal([1]),
  fixedLength: () => Object.defineProperty([1], "length", { writable: false }),
  heir: () => Heir.from([1]),
  loudHeir: () => LoudHeir.from([1]),
  arrayLike: () => ({ length: 1, 0: "a", push: Array.prototype.push }),
  withoutPush: () => ({ length: 0 }),
  notCallable: () => ({ push: 1 }),
  text: () => "text",
  nothing: () => undefined,
};
const values = [1, 0.5, "text", {}, undefined, NaN, -0, 2 ** 31, null];
for (const name in makers) {
  for (const value of values) {
    const a = makers[name](), b = makers[name](), c = makers[name]();
    console.log(name, typeof value, attempt(() => pushes(a, () => value)), attempt(() => show(a)), attempt(() => pushesAtTheEnd(b, () => value)), attempt(() => pushesInALoop(c, () => value)), attempt(() => show(c)));
  }
  const d = makers[name](), e = makers[name]();
  console.log(name, attempt(() => pushesTwo(d, () => 1)), attempt(() => show(d)), attempt(() => keepsPush(e, () => 1)));
}
const deeds = {
  pushesText: a => a.push("text"),
  pushesDouble: a => a.push(0.5),
  addsProperty: a => { a.extra = 1; },
  takesOwnPush: a => { a.push = () => "mine, too late"; },
  freezes: a => Object.freeze(a),
  empties: a => { a.length = 0; },
  lengthens: a => { a.length = 10; },
  becomesSparse: a => { a[100000] = 1; },
  losesPrototype: a => Object.setPrototypeOf(a, null),
  fixesLength: a => Object.defineProperty(a, "length", { writable: false }),
  fills: a => { for (let i = 0; i < 100; i++) a.push(i); },
  definesGetter: a => Object.defineProperty(a, 3, { get: () => "getter", configurable: true }),
};
for (const name in deeds) {
  for (const make of [makers.empty, makers.integers, makers.doubles, makers.values]) {
    const a = make();
    const answer = attempt(() => pushes(a, () => { deeds[name](a); return 7; }));
    console.log(name, answer, a.length, attempt(() => String(Array.prototype.slice.call(a, -2))));
  }
}
const own = [1];
own.push = () => "mine";
console.log(pushes(own, () => { delete own.push; return 2; }), own.length, pushes(own, () => 3), own.length);
