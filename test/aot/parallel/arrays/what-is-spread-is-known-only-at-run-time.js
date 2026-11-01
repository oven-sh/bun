// `[...some]`, `[x, ...some]`, `f(...some)` where the compiler does not know what `some` is: the members of a Set are still appended at once, so the list grows once and not
// step by step, and whatever has a walk of its own is asked for it.
// COUNT: cells <= 9500
const numbers = count => { const set = new Set(); for (let n = 0; n < count; n++) set.add(n * 3); return set; };
const thinned = numbers(10);
for (const n of [0, 9, 27]) thinned.delete(n);
class Counted extends Set {
  *[Symbol.iterator]() { for (const n of super.values()) yield n * 10; }
}
class Plain extends Set {}
const own = numbers(3);
own[Symbol.iterator] = function* () { yield "own"; };
const named = numbers(3);
named.label = "a name more";
const makers = {
  forty: () => numbers(40),
  aHundred: () => numbers(100),
  none: () => new Set(),
  cleared: () => { const set = numbers(4); set.clear(); return set; },
  thinned: () => thinned,
  written: () => new Set(["red", "green", "blue"]),
  mixed: () => new Set([1, "1", null, undefined, true, 1.5, NaN, { a: 1 }]),
  counted: () => new Counted([1, 2, 3]),
  plain: () => new Plain([1, 2, 3]),
  own: () => own,
  named: () => named,
  list: () => [1, 2, 3],
  map: () => new Map([[1, 2]]),
  text: () => "ab",
  keys: () => numbers(3).keys(),
  made: function* () { yield 1; yield 2; },
};
const collect = (...all) => all;
function whole(some) { return [...some]; }
function behind(first, some) { return [first, ...some]; }
function inFront(some, last) { return [...some, last]; }
function twice(some) { return [...some, ...some]; }
function handed(some) { return collect(0, ...some); }
const say = list => list.length + ": " + (list.length > 12 ? [...list.slice(0, 4), "..", ...list.slice(-4)] : list).map(x => (typeof x === "number" || x === undefined ? String(x) : JSON.stringify(x))).join(" ");
const asked = process.argv.slice(2);
const lines = [];
for (const name of asked.length ? asked : Object.keys(makers)) {
  lines.push(name + " whole " + say(whole(makers[name]())));
  lines.push(name + " behind a number " + say(behind(7, makers[name]())));
  lines.push(name + " behind a fraction " + say(behind(0.5, makers[name]())));
  lines.push(name + " behind a text " + say(behind("x", makers[name]())));
  lines.push(name + " in front " + say(inFront(makers[name](), 7)));
  lines.push(name + " twice " + say(twice(makers[name]())));
  lines.push(name + " handed " + say(handed(makers[name]())));
}
for (const nothing of [undefined, null, 5, {}]) {
  try { whole(nothing); } catch (error) { lines.push(String(nothing) + ": " + error.constructor.name); }
}
const some = makers[asked[0] ?? "forty"]();
let sum = 0;
for (let i = 0; i < 1000; i++) sum += whole(some).length + behind(i, some).length + handed(some).length;
lines.push("sum " + sum);
console.log(lines.join("\n"));
