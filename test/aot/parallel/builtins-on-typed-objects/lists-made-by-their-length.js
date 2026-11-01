// Array.from({ length }), Array(n).fill(v), [...Array(n).keys()] and their mapped forms: lengths that are refused, mappers that throw or change things, replaced built-ins.
const log = [];
const note = (label, value) => (log.push(label), value);
const name = value => (Object.is(value, -0) ? "-0" : typeof value === "symbol" ? "symbol" : typeof value === "bigint" ? value + "n" : typeof value === "function" ? "function" : JSON.stringify(value) ?? String(value));
const describe = list => (Array.isArray(list) ? `[${Array.prototype.map.call(Object.assign([], list), name).join()}] length ${list.length} keys ${Object.keys(list).join("")}` : name(list));
function attempt(label, make) {
  let answer;
  try {
    answer = describe(make());
  } catch (error) {
    answer = error.constructor.name;
  }
  console.log(label, answer, "|", log.splice(0).join());
}

const counting = { valueOf: () => note("valueOf", 2) };
const lengths = [0, -0, 1, 3, 2.5, -1, -0.5, NaN, -Infinity, "3", "x", "", null, undefined, true, false, [], [2], {}, counting, 1n, Symbol.iterator];
for (const length of lengths) {
  attempt(`from length ${name(length)}`, () => Array.from({ length }));
  attempt(`from length ${name(length)}, mapped`, () => Array.from({ length }, (value, index) => `${value}${index}`));
  attempt(`filled ${name(length)}`, () => Array(length).fill("f"));
  attempt(`filled with new ${name(length)}`, () => new Array(length).fill("f"));
  attempt(`filled and mapped ${name(length)}`, () => Array(length).fill("f").map((value, index) => value + index));
  attempt(`indexes ${name(length)}`, () => [...Array(length).keys()]);
}
attempt("a length no list has", () => Array.from({ length: 2 ** 32 }, () => note("mapper", 0)));
attempt("a length no list has, filled", () => Array(2 ** 32).fill(0));
attempt("a length no list has, indexes", () => [...Array(2 ** 32).keys()]);

for (const mapper of [undefined, null, 5, "f", {}, [], Symbol.iterator]) {
  attempt(`mapper ${name(mapper)}`, () => Array.from({ length: counting }, mapper));
  attempt(`mapper of map ${name(mapper)}`, () => Array(2).fill(1).map(mapper));
}

attempt("order of evaluation", () => Array.from({ length: note("length", 2) }, note("mapper", (value, index) => note(`call ${index}`, index))));
attempt("the list is refused before the value is evaluated", () => Array(note("length", -1)).fill(note("value", 1)));
attempt("the list is refused before the value is evaluated, with new", () => new Array(note("length", 1.5)).fill(note("value", 1)));
attempt("the list is refused before value and mapper are evaluated", () => Array(note("length", -1)).fill(note("value", 1)).map((note("mapper"), value => value)));
attempt("value, then mapper", () => Array(note("length", 2)).fill(note("value", 1)).map(value => note("call", value + 1)));
attempt("a mapper that throws", () => Array.from({ length: 3 }, (value, index) => { if (note(`call ${index}`, index) === 1) throw new RangeError("stop"); return index; }));
attempt("what a function gets", () => Array.from({ length: 2 }, function () { return `${arguments.length}${typeof this}${name(arguments[0])}${arguments[1]}`; }));
attempt("a receiver for the mapper", () => Array.from({ length: 2 }, function (value, index) { return this.base + index; }, { base: 10 }));
attempt("a bound mapper", () => Array.from({ length: 2 }, Math.max.bind(null, 1)));
attempt("a built-in mapper", () => Array.from({ length: 3 }, Number));
attempt("a built-in mapper that takes both", () => Array.from({ length: 3 }, Array.of));
attempt("an async mapper", () => Array.from({ length: 2 }, async () => 1).map(promise => promise instanceof Promise));
attempt("a class as the mapper", () => Array.from({ length: 1 }, class {}));

const length = 2;
attempt("shorthand", () => Array.from({ length }, (value, index) => index));
attempt("the name as a string", () => Array.from({ "length": 2 }, (value, index) => index));
attempt("the name in brackets", () => Array.from({ ["length"]: 2 }, (value, index) => index));
attempt("a computed name", () => Array.from({ [note("key", "length")]: 2 }, (value, index) => index));
attempt("elements beside the length", () => Array.from({ length: 2, 0: "a", 1: "b" }, value => value));
attempt("a getter", () => Array.from({ get length() { return note("getter", 2); } }, (value, index) => index));
attempt("a spread beside the length", () => Array.from({ length: 2, ...["a", "b"] }, value => value));
attempt("a prototype beside the length", () => Array.from({ __proto__: ["a", "b"], length: 2 }, value => value));
attempt("an iterator beside the length", () => Array.from({ length: 2, *[Symbol.iterator]() { yield "y"; } }, value => value));
attempt("another name", () => Array.from({ size: 2 }, value => value));
attempt("no name", () => Array.from({}, value => value));
attempt("an object somebody holds", () => { const items = { length: 2 }; items[0] = "a"; return Array.from(items, value => value); });
attempt("a spread of arguments", () => Array.from(...[{ length: 2 }, (value, index) => index]));
function shadowed(Array) { return Array.from({ length: 2 }, (value, index) => index); }
attempt("another Array", () => shadowed({ from: (items, mapper) => [`other ${items.length} ${typeof mapper}`] }));
class Stack extends Array {}
attempt("a class below Array", () => [Stack.from({ length: 2 }, (value, index) => index) instanceof Stack, Stack.from({ length: 2 }).length]);
attempt("from, called on another constructor", () => Array.from.call(Stack, { length: 1 }) instanceof Stack);
attempt("optional calls", () => [Array.from?.({ length: 1 }).length, Array?.from({ length: 1 }).length, Array(1)?.fill(0).length, Array(1).fill?.(0).length]);

attempt("fill from an index", () => Array(3).fill(1, 1));
attempt("fill between indexes", () => Array(3).fill(1, 1, 2));
attempt("fill with nothing", () => Array(2).fill());
attempt("two operands are elements", () => Array(2, 3).fill(0));
attempt("no operand", () => Array().fill(0));
attempt("a spread as the length", () => Array(...[2]).fill(0));
const shared = Array(2).fill({});
attempt("one object in every place", () => shared[0] === shared[1]);
attempt("a new object in every place", () => { const lists = Array(2).fill(0).map(() => []); return lists[0] !== lists[1]; });
attempt("a mapper that takes the list", () => Array(2).fill(7).map((value, index, list) => list.length + index));
attempt("a mapper that takes the rest", () => Array(2).fill(7).map((...all) => all.length));
attempt("a mapper that changes the list", () => Array(3).fill(7).map((value, index, list) => { list[index + 1] = index; return value; }));
attempt("a function as the mapper", () => Array(2).fill(7).map(function () { return arguments.length; }));
attempt("a mapper with defaults", () => Array(2).fill(undefined).map((value = "d", index = "i") => value + index));
attempt("a mapper that takes things apart", () => Array(2).fill([1, 2]).map(([first, second], index) => first + second + index));
attempt("a receiver for map", () => Array(1).fill(7).map(function (value) { return this.base + value; }, { base: 1 }));
attempt("map without fill skips the holes", () => Array(2).map(() => 1));
attempt("indexes and more", () => [...Array(2).keys(), 9]);
attempt("more and indexes", () => [9, ...Array(2).keys()]);
attempt("values", () => [...Array(2).values()]);
attempt("entries", () => [...Array(2).entries()].join("|"));
attempt("a spread of the list itself", () => [...Array(2)]);
attempt("keys with an operand", () => [...Array(2).keys(note("operand"))]);
attempt("keys of a written list", () => [...[5, 6].keys()]);

const first = Array.from({ length: 2 }, (value, index) => index), second = Array.from({ length: 2 }, (value, index) => index);
first.push(9);
attempt("each evaluation makes its own", () => [first.length, second.length, first !== second]);
attempt("an ordinary list", () => { const list = Array.from({ length: 1 }); return [list.constructor === Array, Object.getPrototypeOf(list) === Array.prototype, 0 in list, Object.isExtensible(list)]; });
attempt("long", () => { const list = Array.from({ length: 100000 }, (value, index) => index * 2); return [list.length, list[99999], Array(100000).fill(3).length, [...Array(70000).keys()][69999]]; });
function grid(rows, columns) { return Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, column) => row * columns + column)); }
attempt("lists in lists", () => JSON.stringify(grid(2, 3)));
function total(count) { let sum = 0; for (let turn = 0; turn < 300; turn++) for (const value of Array.from({ length: count }, (_, index) => index + turn)) sum += value; return sum; }
attempt("in a loop", () => total(5));
attempt("doubles, then strings", () => Array.from({ length: 4 }, (_, index) => (index < 2 ? index + 0.5 : `s${index}`)));
