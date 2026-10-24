// includes, indexOf and concat on lists that are written for the call: NaN, -0, holes, operands with effects, Symbol.isConcatSpreadable and spreads of iterables.
const log = [];
const note = (label, value) => (log.push(label), value);
const show = (label, value) => console.log(label, Array.isArray(value) ? JSON.stringify(value) + " length " + value.length : Object.is(value, -0) ? "-0" : String(value), "|", log.splice(0).join());
const values = [undefined, null, true, false, 0, -0, 1, 1.5, NaN, Infinity, "", "a", "b", "1", 1n, Symbol.iterator, {}, []];
const name = value => (Object.is(value, -0) ? "-0" : typeof value === "symbol" ? "symbol" : typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? (Array.isArray(value) ? "list" : "object") : JSON.stringify(value) ?? String(value));

function inStrings(x) { return ["a", "b", "1"].includes(x); }
function atStrings(x) { return ["a", "b", "1", "a"].indexOf(x); }
function inNumbers(x) { return [0, 1, 1.5].includes(x); }
function atNumbers(x) { return [1, 0, 1.5, 0].indexOf(x); }
function inNaN(x) { return [NaN, 1].includes(x); }
function atNaN(x) { return [NaN, 1].indexOf(x); }
function inMinusZero(x) { return [-0].includes(x); }
function atMinusZero(x) { return [-0].indexOf(x); }
function inMixed(x) { return [undefined, null, true, "1", 1n].includes(x); }
function atMixed(x) { return [undefined, null, true, "1", 1n].indexOf(x); }
function inVariables(a, b, x) { return [a, b].includes(x); }
function atVariables(a, b, x) { return [a, b].indexOf(x); }
for (const search of [inStrings, atStrings, inNumbers, atNumbers, inNaN, atNaN, inMinusZero, atMinusZero, inMixed, atMixed]) console.log(search.name, values.map(value => name(value) + ":" + search(value)).join(" "));
for (const a of values) console.log("variables", name(a), values.map(x => (inVariables(a, "b", x) ? "y" : "n") + atVariables("b", a, x)).join(" "));
const shared = {};
show("an object is itself", [{}, shared].includes(shared));
show("an object is no other", [{}, {}].includes(shared));
show("ropes", ["ab" + name(1), "x"].includes("a" + "b1"));

show("order of evaluation", [note("a", 1), note("b", 2)].includes(note("x", 2)));
show("every element is evaluated", [note("a", 1), note("b", 2), note("c", 3)].indexOf(note("x", 1)));
show("nothing is searched for", [undefined, 1].includes());
show("nothing is searched for, by index", [1, undefined].indexOf());
show("a hole is undefined for includes", [1, , 2].includes(undefined));
show("a hole is nothing for indexOf", [1, , 2].indexOf(undefined));
show("from an index", [1, 2, 1].includes(1, 1));
show("from an index, by index", [1, 2, 1].indexOf(1, 1));
show("from an index that has an effect", [1, 2].includes(1, { valueOf: () => note("valueOf", 1) }));
show("from the end", [1, 2, 3].indexOf(1, -1));
show("an empty list", [].includes(1));
show("an empty list, by index", [].indexOf(1));
show("a spread", [...[1, 2], 3].includes(2));
show("the last index", [1, 2, 1].lastIndexOf(1));
const kept = [1, 2];
show("a list that somebody else holds", kept.includes(2));
let list;
show("a list that is kept", (list = [1, 2]).includes(2) && list.length);
show("seventeen", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].includes(values.length - 1));
function inCondition(x) { if (["GET", "HEAD"].includes(x)) return "safe"; return ["POST", "PUT"].indexOf(x) >= 0 ? "writes" : "other"; }
show("in a condition", ["GET", "HEAD", "POST", "PUT", "PATCH", 5].map(inCondition).join());
function tail(x) { return ["a", "b"].includes(x); }
show("in tail position", tail("b") + "," + tail("c") + "," + tail(1));
function inLoop(words) { let found = 0; for (const word of words) if (["a", "b"].includes(word)) found++; return found; }
show("in a loop", inLoop(["a", "c", "b", "a", 1]));
function inTry(x) { try { return [x.a, x.b].includes(1); } catch (error) { return error.constructor.name; } }
show("under a handler", inTry({ a: 1 }) + "," + inTry(null));

show("two lists", [1, 2].concat([3, 4]));
show("three lists and values", [note("a", 1)].concat([note("b", 2)], note("c", 3), [note("d", 4), note("e", 5)], "six", null, undefined));
show("nothing is added", [1, 2].concat());
show("empty lists", [].concat([], []));
show("a list in a list stays", [1].concat([[2, 3]], [[]]));
show("holes are kept", [1, , 2].concat([3]));
show("holes of an operand are kept", [1].concat([, 3]));
show("an object is appended", [1].concat({ length: 1, 0: "x" }).length);
show("an object that says it is spread", [1].concat({ length: 2, 0: "x", 1: "y", [Symbol.isConcatSpreadable]: true }));
const closed = [2, 3];
closed[Symbol.isConcatSpreadable] = false;
show("a list that says it is not", [1].concat(closed).length);
show("a list that somebody else holds is copied", [1].concat(kept));
function concatenate(a, b) { return [a].concat(b); }
show("a value nobody knows", JSON.stringify([concatenate(1, 2), concatenate(1, [2, 3]), concatenate(1, "ab"), concatenate([1], [[2]]), concatenate(1, undefined)]));
const first = [1].concat([2]), second = [1].concat([2]);
first.push(3);
show("each evaluation makes its own", first.length + "," + second.length + "," + (first !== second));
show("strings are no lists", ["a"].concat("bc", ["d"]));
show("-0 and NaN", [-0].concat([NaN], -0).map(value => name(value)).join());
class Stack extends Array {}
show("a class below Array", Stack.of(1).concat([2]) instanceof Stack);
show("a spread in the list", [...kept, 3].concat([4]));
show("many", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].concat([21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35]).length);

const someSet = new Set(["a", "b"]), someMap = new Map([["k", 1]]);
function* someWords() { yield "w"; yield "v"; }
const anything = value => value;
function inSet(x) { return [...someSet].includes(x); }
function inKeys(x) { const keys = [...someMap.keys()]; return `${keys.includes(x)} ${keys.indexOf(x)} ${keys.length} ${keys.join()}`; }
function inWords(x) { const list = [...someWords()]; return `${list.includes(x)} ${list.indexOf(x)} ${list.join()} ${list.concat(["u"])}`; }
function inText(x) { return [..."abc"].includes(x); }
function inAnything(iterable, x) { const list = [...iterable]; return `${list.includes(x)} ${list.indexOf(x)} ${list.join("+")} ${list.map(value => value + value)} ${new Set(list).size} ${[...list, x].length}`; }
show("a spread of a set", `${inSet("a")} ${inSet("z")}`);
show("a spread of keys", inKeys("k"));
show("a spread of a generator", inWords("v"));
show("a spread of a text", inText("b"));
show("a spread of anything", [inAnything(anything(someSet), "b"), inAnything(anything(someWords()), "w"), inAnything(anything("xy"), "y"), inAnything(anything([1, 2]), 2), inAnything(anything(someMap.values()), 1)].join(" | "));
