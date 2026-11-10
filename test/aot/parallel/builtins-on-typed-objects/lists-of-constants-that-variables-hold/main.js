// A list of constants that a variable of a module holds is read at the build only if nothing can ever change it: each way to change one, by name.
import { change, changedElsewhere, changedHere, look, lookAtShared, shared } from "./other.js";

const show = (label, ...values) => console.log(label, values.map(value => (Array.isArray(value) ? JSON.stringify(value) : value instanceof Set ? `Set(${[...value].join()})` : Object.is(value, -0) ? "-0" : String(value))).join(" | "));

function early() {
  try {
    return late.includes("a");
  } catch (error) {
    return error.constructor.name;
  }
}
show("read before the list is there", early());
const late = ["a", "b"];
show("read behind it", early());

const words = ["a", "b", "c", "a"];
const inWords = word => [words.includes(word), words.indexOf(word), words.lastIndexOf(word)];
for (const word of ["a", "c", "z", "", undefined, null, 0, NaN, {}]) show(`words ${String(word)}`, ...inWords(word));
show("words joined", words.join(), words.join(""), words.join("-"), words.join(undefined), words.join(null), words.join(1), words.join(words.length > 3 ? "/" : "\\"));
show("words spread", [...words], [...words, "x"], ["x", ...words], [...words, ...words], [0, ...words, 1, ...words, 2]);
show("a set of words", new Set(words), new Set([...words, "x"]), new Set(words).size);
show("words from an index", words.includes("a", 1), words.includes("a", 4), words.indexOf("a", 1), words.indexOf("a", -1));
const copy = [...words];
copy.push("more");
copy[0] = "changed";
show("a copy is nobody's list", copy, words, [...words] !== [...words], new Set(words) !== new Set(words));
const set = new Set(words);
set.add("more");
show("a set is nobody's set", set, new Set(words));

const mixed = [0, -0, 1, 1.5, NaN, "1", true, false, null, undefined, ""];
const inMixed = value => [mixed.includes(value), mixed.indexOf(value)];
for (const value of [0, -0, 1, 1.5, NaN, "1", "", true, false, null, undefined, "x", 2, 1n]) show(`mixed ${Object.is(value, -0) ? "-0" : typeof value === "bigint" ? "1n" : JSON.stringify(value) ?? String(value)}`, ...inMixed(value));
show("mixed joined", mixed.join(), mixed.join("|"));
show("mixed spread", [...mixed].map(value => (Object.is(value, -0) ? "-0" : String(value))).join());
show("a set of mixed", new Set(mixed).size, Object.is([...new Set([-0])][0], 0));
const numbers = [1e21, 1e-7, 0.1, 123456789012345680000, -1.5, 2 ** 31, -(2 ** 31), 4294967296];
show("numbers joined", numbers.join(" "));
const empty = [];
show("empty", empty.includes(undefined), empty.indexOf(1), `[${empty.join("-")}]`, [...empty], [...empty, 1], new Set(empty).size);
const holes = ["a", , "c"];
show("holes", holes.includes(undefined), holes.indexOf(undefined), holes.join(), [...holes], new Set(holes).size);
const nested = [["a"], ["b"]];
show("lists in a list", nested.includes(nested[0]), nested.indexOf(nested[1]), nested.join(), [...nested][0] === nested[0]);
const big = [1n, 2n];
show("bigints", big.includes(1n), big.indexOf(2n), big.join());
const long = ["a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "b0", "b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8", "b9", "c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8", "d9"];
show("long", long.includes("d9"), long.includes("e0"), long.indexOf("c5"), long.join("").length, [...long, ...long].length, new Set(long).size);

const byPush = ["a", "b", "c"], byPop = ["a", "b", "c"], byShift = ["a", "b", "c"], byUnshift = ["a", "b", "c"], bySplice = ["a", "b", "c"], bySort = ["a", "b", "c"], byReverse = ["a", "b", "c"], byFill = ["a", "b", "c"];
const byCopyWithin = ["a", "b", "c"], byIndex = ["a", "b", "c"], byBeyond = ["a", "b", "c"], byLength = ["a", "b", "c"], byRemove = ["a", "b", "c"], byDefine = ["a", "b", "c"], byGetter = ["a", "b", "c"], byAssign = ["a", "b", "c"];
const byReflect = ["a", "b", "c"], byBorrowed = ["a", "b", "c"], byApplied = ["a", "b", "c"], byIterator = ["a", "b", "c"], byPrototype = ["a", "b", "c"], byMethod = ["a", "b", "c"];
const looks = {
  push: () => [byPush.includes("z"), byPush.indexOf("c"), byPush.join(), [...byPush], new Set(byPush)],
  pop: () => [byPop.includes("c"), byPop.indexOf("c"), byPop.join(), [...byPop], new Set(byPop)],
  shift: () => [byShift.includes("a"), byShift.indexOf("c"), byShift.join(), [...byShift], new Set(byShift)],
  unshift: () => [byUnshift.includes("z"), byUnshift.indexOf("c"), byUnshift.join(), [...byUnshift], new Set(byUnshift)],
  splice: () => [bySplice.includes("z"), bySplice.indexOf("b"), bySplice.join(), [...bySplice], new Set(bySplice)],
  sort: () => [bySort.includes("a"), bySort.indexOf("c"), bySort.join(), [...bySort], new Set(bySort)],
  reverse: () => [byReverse.includes("a"), byReverse.indexOf("c"), byReverse.join(), [...byReverse], new Set(byReverse)],
  fill: () => [byFill.includes("a"), byFill.indexOf("z"), byFill.join(), [...byFill], new Set(byFill)],
  copyWithin: () => [byCopyWithin.includes("a"), byCopyWithin.indexOf("c"), byCopyWithin.join(), [...byCopyWithin], new Set(byCopyWithin)],
  index: () => [byIndex.includes("z"), byIndex.indexOf("b"), byIndex.join(), [...byIndex], new Set(byIndex)],
  beyond: () => [byBeyond.includes(undefined), byBeyond.indexOf("z"), byBeyond.join(), [...byBeyond], new Set(byBeyond)],
  length: () => [byLength.includes("c"), byLength.indexOf("b"), byLength.join(), [...byLength], new Set(byLength)],
  remove: () => [byRemove.includes("b"), byRemove.indexOf("b"), byRemove.join(), [...byRemove], new Set(byRemove)],
  define: () => [byDefine.includes("z"), byDefine.indexOf("b"), byDefine.join(), [...byDefine], new Set(byDefine)],
  getter: () => [byGetter.includes("z"), byGetter.indexOf("b"), byGetter.join(), [...byGetter], new Set(byGetter)],
  assign: () => [byAssign.includes("z"), byAssign.indexOf("a"), byAssign.join(), [...byAssign], new Set(byAssign)],
  reflect: () => [byReflect.includes("z"), byReflect.indexOf("b"), byReflect.join(), [...byReflect], new Set(byReflect)],
  borrowed: () => [byBorrowed.includes("z"), byBorrowed.indexOf("z"), byBorrowed.join(), [...byBorrowed], new Set(byBorrowed)],
  applied: () => [byApplied.includes("z"), byApplied.indexOf("z"), byApplied.join(), [...byApplied], new Set(byApplied)],
  iterator: () => [byIterator.includes("z"), byIterator.indexOf("c"), byIterator.join(), [...byIterator], new Set(byIterator)],
  prototype: () => [byPrototype.includes("z"), byPrototype.indexOf("c"), byPrototype.join(), [...byPrototype], new Set(byPrototype)],
  method: () => [byMethod.includes("z"), byMethod.indexOf("c"), byMethod.join(), [...byMethod], new Set(byMethod)],
};
show("push, before", ...looks.push());
byPush.push("z");
show("push, behind", ...looks.push());
show("pop, before", ...looks.pop());
byPop.pop();
show("pop, behind", ...looks.pop());
show("shift, before", ...looks.shift());
byShift.shift();
show("shift, behind", ...looks.shift());
show("unshift, before", ...looks.unshift());
byUnshift.unshift("z");
show("unshift, behind", ...looks.unshift());
show("splice, before", ...looks.splice());
bySplice.splice(1, 1, "z");
show("splice, behind", ...looks.splice());
show("sort, before", ...looks.sort());
bySort.sort((a, b) => (a < b ? 1 : -1));
show("sort, behind", ...looks.sort());
show("reverse, before", ...looks.reverse());
byReverse.reverse();
show("reverse, behind", ...looks.reverse());
show("fill, before", ...looks.fill());
byFill.fill("z");
show("fill, behind", ...looks.fill());
show("copyWithin, before", ...looks.copyWithin());
byCopyWithin.copyWithin(0, 1);
show("copyWithin, behind", ...looks.copyWithin());
show("index, before", ...looks.index());
byIndex[1] = "z";
show("index, behind", ...looks.index());
show("beyond, before", ...looks.beyond());
byBeyond[5] = "z";
show("beyond, behind", ...looks.beyond());
show("length, before", ...looks.length());
byLength.length = 1;
show("length, behind", ...looks.length());
show("remove, before", ...looks.remove());
delete byRemove[1];
show("remove, behind", ...looks.remove());
show("define, before", ...looks.define());
Object.defineProperty(byDefine, 1, { value: "z" });
show("define, behind", ...looks.define());
show("getter, before", ...looks.getter());
Object.defineProperty(byGetter, 1, { get: () => "z" });
show("getter, behind", ...looks.getter());
show("assign, before", ...looks.assign());
Object.assign(byAssign, ["z"]);
show("assign, behind", ...looks.assign());
show("reflect, before", ...looks.reflect());
Reflect.set(byReflect, 1, "z");
show("reflect, behind", ...looks.reflect());
show("borrowed, before", ...looks.borrowed());
Array.prototype.push.call(byBorrowed, "z");
show("borrowed, behind", ...looks.borrowed());
show("applied, before", ...looks.applied());
Array.prototype.push.apply(byApplied, ["z"]);
show("applied, behind", ...looks.applied());
show("iterator, before", ...looks.iterator());
byIterator[Symbol.iterator] = function* () { yield "z"; };
show("iterator, behind", ...looks.iterator());
show("prototype, before", ...looks.prototype());
Object.setPrototypeOf(byPrototype, { includes: () => "other", indexOf: () => "other", join: () => "other", [Symbol.iterator]: function* () { yield "z"; } });
show("prototype, behind", ...looks.prototype());
show("method, before", ...looks.method());
byMethod.includes = () => "own";
show("method, behind", ...looks.method());

const direct = ["a", "b"];
const lookAtDirect = () => [direct.includes("z"), direct.join(), [...direct]];
show("changed by name, before", ...lookAtDirect());
direct.push("z");
show("changed by name, behind", ...lookAtDirect());
const aliased = ["a", "b"];
const alias = aliased;
const lookAtAliased = () => [aliased.includes("z"), aliased.join(), [...aliased]];
alias[0] = "z";
show("changed through another variable", ...lookAtAliased());
const held = ["a", "b"];
const holder = { list: held };
const lookAtHeld = () => [held.includes("z"), held.join(), [...held]];
holder.list.push("z");
show("changed through an object", ...lookAtHeld());
const returned = ["a", "b"];
const give = () => returned;
const lookAtReturned = () => [returned.includes("z"), returned.join(), [...returned]];
give().push("z");
show("changed through a result", ...lookAtReturned());
const captured = ["a", "b"];
const lookAtCaptured = () => [captured.includes("z"), captured.join(), [...captured]];
[captured].forEach(list => list.push("z"));
show("changed in a callback", ...lookAtCaptured());
const serialized = ["a", "b"];
show("handed to native code that only reads", JSON.stringify(serialized), serialized.includes("b"), serialized.join());
const revived = ["a", "b"];
JSON.stringify({ revived }, (key, value) => (Array.isArray(value) ? (value.push("z"), value) : value));
show("changed by a callback of native code", revived.includes("z"), revived.join());

let replaced = ["a", "b"];
const lookAtReplaced = () => [replaced.includes("z"), replaced.join(), [...replaced]];
show("another list is stored, before", ...lookAtReplaced());
replaced = ["z"];
show("another list is stored, behind", ...lookAtReplaced());
var hoisted;
const lookAtHoisted = () => (hoisted ? [hoisted.includes("a"), hoisted.join()] : ["nothing yet"]);
show("a var, before", ...lookAtHoisted());
hoisted = ["a", "b"];
show("a var, behind", ...lookAtHoisted());
let either = words.length > 3 ? ["a"] : ["b"];
show("one of two lists", either.includes("a"), either.join());
class Holder {
  static list = ["a", "b"];
  static look() { return [Holder.list.includes("z"), Holder.list.join()]; }
}
Holder.list.push("z");
show("a static field", ...Holder.look());
function local() {
  const list = ["a", "b"];
  const inner = () => [list.includes("z"), list.join()];
  const before = inner();
  list.push("z");
  return [...before, ...inner()];
}
show("a list of a function", ...local());
const frozen = Object.freeze(["a", "b"]);
show("frozen", frozen.includes("b"), frozen.indexOf("z"), frozen.join(), [...frozen], new Set(frozen));

show("of another module", shared.includes("b"), shared.indexOf("z"), shared.join("+"), [...shared], new Set(shared), lookAtShared("c"));
show("handed to another module", look(shared, "c"));
changedElsewhere.push("z");
show("of another module, changed here", changedElsewhere.includes("z"), changedElsewhere.join(), look(changedElsewhere, "z"));
show("of another module, changed there, before", changedHere.includes("z"), changedHere.join());
change();
show("of another module, changed there, behind", changedHere.includes("z"), changedHere.join());

const completed = [...late, "x"];
const completedTwice = ["w", ...late, ...late];
const completedByValue = [...late, late.length];
const lookAtCompleted = word => [completed.includes(word), completed.indexOf(word), completed.join(), [...completed], new Set(completed), completedTwice.includes(word), completedTwice.join(), completedByValue.includes(2), completedByValue.join()];
show("a literal with spreads", ...lookAtCompleted("x"), ...lookAtCompleted("a"), ...lookAtCompleted("w"));
function completedHere(word) {
  const list = [...late, "x"];
  return [list.includes(word), list.includes("a"), list.indexOf("x"), list.join(), list.length];
}
show("a literal with spreads in a function", ...completedHere("x"), ...completedHere("z"));
function usedTwice(word) {
  const list = ["a", "b"];
  return [list.includes(word), list.indexOf(word), list.join("+"), list.length, [...list, word]];
}
show("a literal that is used several times", ...usedTwice("b"), ...usedTwice("z"));
function pushedHere(word) {
  const list = ["a", "b"];
  const before = list.includes(word);
  list.push(word);
  return [before, list.includes(word), list.join()];
}
show("a literal that is pushed to", ...pushedHere("z"));

const methods = ["GET", "HEAD", "POST"];
function route(method) { if (methods.includes(method)) return methods.indexOf(method); return -2; }
let total = 0;
for (let turn = 0; turn < 3000; turn++) total += route(turn % 3 ? "POST" : turn % 5 ? "PATCH" : "GET");
show("in a loop", total);
const pattern = new RegExp(`^(?:${methods.join("|")})$`, "i");
show("in a pattern", pattern.source, pattern.test("head"), pattern.test("patch"));
