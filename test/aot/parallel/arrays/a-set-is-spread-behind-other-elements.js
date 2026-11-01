// `[x, ...set]`, `[...set, x]`, `[...one, ...other]` and `f(x, ...set)`: the members go behind what the list holds already, whatever the list and the set hold,
// at the top level, in a function, in a method and in a field.
const numbers = (count, from = 0) => { const set = new Set(); for (let n = 0; n < count; n++) set.add(from + n); return set; };
const texts = count => { const set = new Set(); for (let n = 0; n < count; n++) set.add("t" + n); return set; };
const say = (list, i) => (!(i in list) ? "hole" : Object.is(list[i], -0) ? "-0" : typeof list[i] === "number" || list[i] === undefined ? String(list[i]) : JSON.stringify(list[i]));
const lines = [];
function show(label, list) {
  const said = [];
  for (let i = 0; i < list.length; i++) if (list.length <= 12 || i < 4 || i >= list.length - 4) said.push(say(list, i));
  lines.push(label + ": " + list.length + ": " + said.join(" "));
}

const written = new Set([3, 1, 4, 5, 9]);
const words = new Set(["red", "green", "blue"]);
const mixed = new Set([1, "1", null, undefined, true, 1.5, NaN, -0, { a: 1 }, [2]]);
const fractions = new Set([0.5, 1.5, 2 ** 40]);
const never = new Set();
const cleared = numbers(4);
cleared.clear();
const thinned = numbers(10);
for (const n of [0, 3, 4, 9]) thinned.delete(n);
const thinnedTexts = texts(10);
for (const n of [0, 3, 4, 9]) thinnedTexts.delete("t" + n);

show("a number, numbers", [7, ...written]);
show("numbers, a number", [...written, 7]);
show("a fraction, numbers", [0.5, ...written]);
show("numbers, a fraction", [...written, 0.5]);
show("a number, fractions", [7, ...fractions]);
show("a text, numbers", ["x", ...written]);
show("a number, texts", [7, ...words]);
show("a text, texts", ["x", ...words]);
show("texts, a text", [...words, "x"]);
show("a number, a mix", [7, ...mixed]);
show("a fraction, a mix", [0.5, ...mixed]);
show("an object, a mix", [{ b: 2 }, ...mixed]);
show("a hole, numbers", [, ...written]);
show("undefined, numbers", [undefined, ...written]);
show("a number, nothing", [7, ...never]);
show("nothing, a number", [...never, 7]);
show("a number, cleared", [7, ...cleared]);
show("nothing, nothing", [...never, ...cleared]);
show("a number, thinned", [7, ...thinned]);
show("a fraction, thinned", [0.5, ...thinned]);
show("a text, thinned", ["x", ...thinned]);
show("a text, thinned texts", ["x", ...thinnedTexts]);
show("two sets", [...written, ...words]);
show("the same set twice", [...written, ...written]);
show("three sets", [...words, ...written, ...fractions]);
show("a list, a set", [...[9, 8], ...written]);
show("a set, a list", [...written, ...[9, 8]]);
show("a set, a text", [...written, ..."ab"]);
show("in the middle", [-1, ...written, -2, ...words, -3]);
for (const count of [0, 1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 63, 64, 65, 100, 255, 256, 257, 1000, 70000]) {
  show("a number, " + count, [-1, ...numbers(count)]);
  show("a text, " + count + " texts", ["x", ...texts(count)]);
  show(count + " and " + count, [...numbers(count), ...numbers(count, 1000000)]);
}

const collect = (...all) => all;
const third = (a, b, c) => [c, b, a];
show("arguments behind one", collect(0, ...written));
show("arguments in front of one", collect(...written, 0));
show("arguments of two sets", collect(...written, ...words));
show("named parameters", third(...words));
show("named parameters behind one", third("x", ...words));
show("Math.max behind one", [Math.max(100, ...written), Math.max(0, ...written), Math.max(0, ...never)]);
show("new Array behind one", new Array(0, ...written));
const pushed = [0];
pushed.push(1, ...written);
show("push behind one", pushed);
class Sum { constructor(...all) { this.all = all; } }
show("new behind one", new Sum(0, ...words).all);

function behind(first, set) { return [first, ...set]; }
function inFront(set, last) { return [...set, last]; }
function both(one, other) { return [...one, ...other]; }
for (const set of [written, words, mixed, fractions, never, cleared, thinned, thinnedTexts]) {
  show("in a function, behind a number", behind(7, set));
  show("in a function, behind a text", behind("x", set));
  show("in a function, in front", inFront(set, 7));
  show("in a function, twice", both(set, set));
}
class Holder {
  held = [0, ...written];
  static kept = ["x", ...words, ...written];
  constructor(set) { this.set = set; }
  behind(first) { return [first, ...this.set]; }
  get twice() { return [...this.set, ...this.set]; }
}
show("in a field", new Holder(words).held);
show("in a static field", Holder.kept);
show("in a method", new Holder(words).behind(1));
show("in a getter", new Holder(thinned).twice);

// The list is the program's own, and takes whatever is stored next.
const source = numbers(3);
const copy = [-1, ...source];
copy.push(0.5, "text");
source.add(50);
show("the copy", copy);
show("the source", [-1, ...source]);
const objects = new Set([{ n: 1 }, { n: 2 }]);
const same = [null, ...objects];
lines.push("the same objects " + same.slice(1).every(o => objects.has(o)));
same[1].n = 10;
lines.push("seen through the set " + [...objects][0].n);

// What stands between the list and the spread runs first, and what it does to the set counts.
const late = numbers(2);
show("added on the way", [late.add(9).size, ...late]);
show("taken out on the way", [late.delete(0), ...late, late.delete(1), ...late]);

// A walk of its own is asked.
class Counted extends Set {
  *[Symbol.iterator]() { for (const n of super.values()) yield n * 10; }
}
show("a subclass with a walk of its own", [0, ...new Counted([1, 2, 3])]);
class Plain extends Set {}
show("a subclass without", [0, ...new Plain([1, 2, 3])]);
const own = numbers(3);
own[Symbol.iterator] = function* () { yield "own"; };
show("a walk of its own", [0, ...own]);

console.log(lines.join("\n"));
