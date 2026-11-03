// map, forEach, some, every, filter, find and findIndex on a list that is written for the call: the callbacks run in the order, with the operands and as often as plain Bun runs them.
const log = [];
const note = (label, value) => (log.push(label), value);
function attempt(label, run) {
  let answer;
  try {
    answer = run();
  } catch (error) {
    answer = error.constructor.name;
  }
  console.log(label, Array.isArray(answer) ? `${JSON.stringify(answer)} length ${answer.length}` : String(answer), "|", log.splice(0).join());
}
const one = () => 1 + log.length, two = () => 2 + log.length;

attempt("map", () => [one(), two()].map(value => value * 10));
attempt("map with the index", () => ["a", "b", "c"].map((value, index) => value + index));
attempt("map without parameters", () => [1, 2].map(() => note("call", 7)));
attempt("map, order", () => [note("a", 1), note("b", 2)].map(note("callback", value => note(`call ${value}`, value))));
attempt("map over nothing", () => [].map(value => note("call", value)));
attempt("map that throws", () => [1, 2, 3].map(value => { if (note(`call ${value}`, value) === 2) throw new RangeError("stop"); return value; }));
attempt("map with the list", () => [1, 2].map((value, index, list) => list.length + value));
attempt("map with the list, changed", () => [1, 2, 3].map((value, index, list) => { list[2] = 9; return value; }));
attempt("map with the rest", () => [1, 2].map((...all) => all.length));
attempt("map with arguments", () => [1, 2].map(function () { return arguments.length; }));
attempt("map with this", () => [1, 2].map(function (value) { return typeof this + value; }));
attempt("map with a receiver", () => [1, 2].map(function (value) { return this.base + value; }, { base: 10 }));
attempt("map with a receiver, an arrow", () => [1, 2].map(value => value + 1, { base: 10 }));
attempt("map with defaults", () => [undefined, 2].map((value = "d", index = "i") => `${value}${index}`));
attempt("map that takes apart", () => [[1, 2], [3, 4]].map(([first, second]) => first + second));
attempt("map with holes", () => [1, , 3].map(value => note("call", value * 2)));
attempt("map with a spread", () => [...[1, 2], 3].map(value => value * 2));
attempt("map with a built-in", () => ["1", "2", "3"].map(Number));
attempt("map with parseInt", () => ["10", "10", "10"].map(parseInt));
attempt("map with a bound function", () => [1, 2].map(Math.max.bind(null, 1.5)));
attempt("map with what is no function", () => [1].map(5));
attempt("map with what is no function, over nothing", () => [].map(undefined));
attempt("map with a class", () => [1].map(class {}));
attempt("map with a class, over nothing", () => [].map(class {}));
attempt("map with an async function", () => [1, 2].map(async value => value).every(promise => promise instanceof Promise));
attempt("map with a generator", () => [1].map(function* (value) { yield value; })[0].next().value);
attempt("map in map", () => [1, 2].map(row => [10, 20].map(column => row * column)));
attempt("map, a function that has a name", () => { const double = value => value * 2; return [1, 2].map(double).concat([3].map(double)); });
attempt("map, one of two functions", () => [1, 2].map(log.length ? value => value : value => -value));
attempt("map, a closure over a variable that changes", () => { let sum = 0; const sums = [1, 2, 3].map(value => (sum += value)); return [...sums, sum]; });
attempt("each evaluation makes its own", () => { const make = () => [1, 2].map(value => value); const first = make(), second = make(); first.push(3); return [first.length, second.length, first !== second]; });
attempt("an ordinary list", () => { const list = [1, 2].map(value => value); return [list.constructor === Array, Object.keys(list).join(), 1 in list]; });

attempt("forEach", () => [one(), two()].forEach(value => note(`call ${value}`)));
attempt("forEach with the index", () => ["a", "b"].forEach((value, index) => note(value + index)));
attempt("forEach with holes", () => [1, , 3].forEach(value => note(`call ${value}`)));
attempt("forEach that throws", () => [1, 2].forEach(value => { note(`call ${value}`); throw new TypeError("stop"); }));

attempt("some, found", () => [1, 2, 3].some(value => note(`call ${value}`, value === 2)));
attempt("some, not found", () => [1, 2, 3].some(value => note(`call ${value}`, value === 9)));
attempt("some over nothing", () => [].some(() => true));
attempt("some, what counts as true", () => [[0, "", null, undefined, NaN, 0n].some(value => value), [0, "a"].some(value => value), [{}].some(value => value), [-0].some(value => value)]);
attempt("every, all", () => [1, 2, 3].every(value => note(`call ${value}`, value > 0)));
attempt("every, not all", () => [1, 2, 3].every(value => note(`call ${value}`, value < 2)));
attempt("every over nothing", () => [].every(() => false));
attempt("find, found", () => [{ id: 1 }, { id: 2 }].find(item => note(`call ${item.id}`, item.id === 2)).id);
attempt("find, not found", () => [1, 2].find(value => value === 9));
attempt("find undefined", () => [undefined, 1].find(value => value === undefined));
attempt("find with holes", () => [, 1].find(value => note(`call ${value}`, value === undefined)));
attempt("findIndex, found", () => ["a", "b"].findIndex(value => value === "b"));
attempt("findIndex, not found", () => ["a", "b"].findIndex(value => value === "z"));
attempt("findIndex with the index", () => ["a", "b"].findIndex((value, index) => index === 1));
attempt("findLast", () => [1, 2, 3].findLast(value => note(`call ${value}`, value < 3)));

attempt("filter", () => [1, 2, 3, 4].filter(value => note(`call ${value}`, value % 2)));
attempt("filter, none", () => [1, 2].filter(() => false));
attempt("filter, all", () => [1, 2].filter(() => true));
attempt("filter with the index", () => ["a", "b", "c"].filter((value, index) => index !== 1));
attempt("filter(Boolean)", () => [0, 1, "", "a", null, undefined, NaN, {}, [], -0, 0n, 1n, false, true].filter(Boolean).length);
attempt("filter(Boolean) on values", () => [one() > 5 && "first", two() && "second", log.length ? "third" : null].filter(Boolean));
attempt("filter(Boolean), joined", () => ["a", log.length && "b", "c"].filter(Boolean).join(" "));
attempt("filter(Boolean) with holes", () => [1, , 2].filter(Boolean));
attempt("some(Boolean), every(Boolean), find(Boolean), findIndex(Boolean), map(Boolean)", () => [[0, 1].some(Boolean), [0, 1].every(Boolean), [0, "x"].find(Boolean), [0, "x"].findIndex(Boolean), ...[0, "x"].map(Boolean)]);
attempt("another Boolean", () => { const Boolean = value => !value; return [0, 1].filter(Boolean); });
attempt("filter keeps the element, not the answer", () => [1, 2].filter(value => value * 0 + "x"));
attempt("filter, each evaluation makes its own", () => { const make = () => [1, 2].filter(Boolean); return make() !== make(); });

const kept = [1, 2, 3];
attempt("a list that somebody holds", () => kept.map(value => value * 2));
attempt("a list that somebody holds, changed by the callback", () => { const list = [1, 2, 3]; return list.map(value => { list.pop(); return value; }); });
attempt("a list that is kept", () => { let list; const mapped = (list = [1, 2]).map(value => value + 1); return [...mapped, list.length]; });
const words = ["a", "b", "c"];
attempt("a list of constants that a variable holds", () => [words.map(word => word.toUpperCase()).join(), words.some(word => word === "b"), words.filter(word => word !== "b").join(), words.find(word => word > "a"), words.findIndex(word => word === "c"), words.every(word => word.length === 1)]);
attempt("a list of constants, with the list", () => words.map((word, index, list) => list === words));
attempt("seventeen", () => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map(value => value + 1).length);
function tail(value) { return [value, value + 1].map(item => item * 2); }
attempt("in tail position", () => tail(1));
function inTry(value) { try { return [value.a, value.b].map(item => item.x); } catch (error) { return error.constructor.name; } finally { note("finally"); } }
attempt("under a handler", () => [inTry({ a: { x: 1 }, b: { x: 2 } }), inTry({ a: { x: 1 } }), inTry(null)].join());
function inLoop(count) { let sum = 0; for (let turn = 0; turn < count; turn++) sum += [turn, turn + 1].map(value => value * 2).filter(value => value % 3).some(value => value > 10) ? 1 : 0; return sum; }
attempt("in a loop", () => inLoop(500));
function* inGenerator() { yield [1, 2].map(value => value + 1); yield [1, 2].some(value => value > 1); }
attempt("in a generator", () => [...inGenerator()].join("|"));
async function inAsync() { return [await 1, await 2].map(value => value + 1); }
inAsync().then(list => console.log("in an async function", JSON.stringify(list)));
attempt("recursion", () => { const depth = value => (value ? [value - 1].map(depth)[0] + 1 : 0); return depth(20); });
