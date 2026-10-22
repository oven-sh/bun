// What a list holds is known only where every element is written: spreads of generators, iterators with effects, arguments, sets that change, texts, replaced iterators and spreads in spreads.
const log = [];
const note = (label, value) => (log.push(label), value);
const look = (list, word) => `${list.includes(word)} ${list.indexOf(word)} [${list.join()}] ${list.length} ${[...list, word].length} ${new Set(list).size} ${list.map(value => `${value}!`).join("")} ${list.some(value => value === word)} ${list.filter(Boolean).length} ${list.concat([word]).length}`;
const show = (label, answer) => console.log(label, answer, "|", log.splice(0).join());

function* generator() { note("first"); yield "a"; note("second"); yield "b"; note("end"); }
function ofGenerator(word) { const list = [...generator()]; return look(list, word); }
show("a generator", ofGenerator("b"));
function ofGeneratorAndMore(word) { const list = ["x", ...generator(), "y"]; return look(list, word); }
show("a generator between elements", ofGeneratorAndMore("y"));
function searchedAtOnce(word) { return `${[...generator()].includes(word)} ${[...generator()].indexOf(word)} ${[...generator()].join("-")} ${[...generator()].map(value => value + value)} ${[...generator()].some(value => value === word)}`; }
show("a generator, used at once", searchedAtOnce("b"));

const counting = { from: 0, [Symbol.iterator]() { note("opened"); let step = this.from; return { next: () => (note(`step ${step}`), step < 2 ? { done: false, value: `v${step++}` } : { done: true }), return: () => (note("closed"), {}) }; } };
function ofIterator(word) { const list = [...counting]; return look(list, word); }
show("an iterator that is seen at work", ofIterator("v1"));
function ofIteratorTwice(word) { const list = [...counting, ...counting]; return look(list, word); }
show("an iterator, twice", ofIteratorTwice("v0"));
const failing = { *[Symbol.iterator]() { yield "a"; throw new RangeError("stop"); } };
function ofFailing() { try { const list = ["x", ...failing]; return look(list, "x"); } catch (error) { return error.constructor.name; } }
show("an iterator that throws", ofFailing());

function ofArguments() { const list = [...arguments]; return look(list, "b"); }
show("arguments", ofArguments("a", "b"));
show("arguments, none", ofArguments());
function ofRest(...rest) { const list = [...rest, "z"]; return look(list, "z"); }
show("a rest parameter", ofRest("a", "b"));
function ofParameter(given, word) { const list = [...given]; return look(list, word); }
show("a parameter: a list, a text, a set, a map, a typed array", [ofParameter(["p", "q"], "q"), ofParameter("pq", "q"), ofParameter(new Set(["p"]), "p"), ofParameter(new Map([["k", 1]]), "k"), ofParameter(new Uint8Array([1, 2]), 2)].join(" || "));
function ofNothing(given) { try { return look([...given], 1); } catch (error) { return error.constructor.name; } }
show("what cannot be spread", [ofNothing(null), ofNothing(undefined), ofNothing(5), ofNothing({})].join());

const growing = new Set(["a"]);
const ofGrowing = word => { const list = [...growing]; return look(list, word); };
show("a set, before", ofGrowing("b"));
growing.add("b");
show("a set, behind", ofGrowing("b"));
growing.delete("a");
show("a set, behind again", ofGrowing("a"));
const early = [...growing];
growing.add("late");
show("a list made of the set before it grew", look(early, "late"));
const fixedSet = new Set(["a", "b"]);
const ofFixedSet = word => look([...fixedSet], word);
show("a set nobody changes", ofFixedSet("b"));
const table = new Map([["k", "v"]]);
show("keys, values, entries", [look([...table.keys()], "k"), look([...table.values()], "v"), [...table.entries()].join("|"), [...table].length].join(" || "));

show("a text", look([..."abc"], "b"));
show("a text outside the basic plane", look([..."a😀"], "😀"));
show("an empty text", look([...""], ""));
const text = "xy";
show("a text that has a name", look([...text, "z"], "y"));

const replaced = ["a", "b"];
replaced[Symbol.iterator] = function* () { note("replaced"); yield "other"; };
show("a list with its own iterator", look([...replaced], "other"));
const inherited = Object.setPrototypeOf(["a"], { __proto__: Array.prototype, *[Symbol.iterator]() { yield "inherited"; } });
show("a list that inherits another iterator", look([...inherited], "inherited"));
class Stack extends Array { *[Symbol.iterator]() { yield "stack"; } }
show("a class below Array with its own iterator", look([...Stack.of("a")], "stack"));
const arrayLike = { length: 2, 0: "a", 1: "b" };
show("what only looks like a list", (() => { try { return look([...arrayLike], "a"); } catch (error) { return error.constructor.name; } })());

const inner = ["a", "b"], middle = [...inner, "c"], outer = ["z", ...middle, ...inner];
show("spreads in spreads, by name", [look(inner, "b"), look(middle, "c"), look(outer, "a")].join(" || "));
show("spreads in spreads, written", look([...[...["a"], "b"], ...[...[], ...["c"]]], "c"));
show("spreads in spreads, with a generator inside", look(["x", ...[...generator(), "y"]], "y"));
function nested(word) { const first = ["a"], second = [...first, word], third = [...second, ...first]; return `${look(first, word)} || ${look(second, word)} || ${look(third, word)}`; }
show("spreads in spreads, in a function", nested("w"));
const holes = [...[1, , 3]];
show("a spread of holes", `${holes.includes(undefined)} ${holes.indexOf(undefined)} ${1 in holes} ${holes.length}`);

const changedLater = ["a", "b"];
const copyBefore = [...changedLater];
const lookAtCopies = () => `${look(copyBefore, "c")} || ${look([...changedLater], "c")}`;
show("a spread of a list that changes later, before", lookAtCopies());
changedLater.push("c");
show("a spread of a list that changes later, behind", lookAtCopies());
const pushedBehind = [...inner];
pushedBehind.push("p");
show("a completed literal that is pushed to", look(pushedBehind, "p"));
let turns = 0;
for (let turn = 0; turn < 400; turn++) turns += [...generatorOf(turn % 3)].includes(1) ? 1 : 0;
function* generatorOf(count) { for (let index = 0; index < count; index++) yield index; }
log.length = 0;
show("in a loop", turns);
