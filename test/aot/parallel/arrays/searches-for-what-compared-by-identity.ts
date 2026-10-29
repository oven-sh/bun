// indexOf() and includes(): what is compared by identity is searched by its bits: in arrays of every storage, short and long, with holes, from an index, in subclasses and proxies, for values of known and of open types.
type Item = { i: number };
const items: Item[] = Array.from({ length: 40 }, (_, i) => ({ i }));
const few: Item[] = items.slice(0, 5);
const other: Item = { i: -1 };
function at(list: Item[], item: Item) { return [list.indexOf(item), list.includes(item)].join(); }
console.log("long", at(items, items[0]), at(items, items[39]), at(items, items[17]), at(items, other));
console.log("short", at(few, few[0]), at(few, few[4]), at(few, items[5]), at(few, other), at([], other));
const holey: (Item | undefined)[] = [items[0], , items[2], undefined, items[4]];
function atMaybe(list: (Item | undefined)[], item: Item) { return [list.indexOf(item), list.includes(item)].join(); }
console.log("holes", atMaybe(holey, items[0]), atMaybe(holey, items[2]), atMaybe(holey, items[4]), atMaybe(holey, items[1]));
const symbols: symbol[] = [Symbol("a"), Symbol.iterator, Symbol.for("c")];
function atSymbol(list: symbol[], s: symbol) { return [list.indexOf(s), list.includes(s)].join(); }
console.log("symbols", atSymbol(symbols, Symbol.iterator), atSymbol(symbols, Symbol.for("c")), atSymbol(symbols, Symbol("a")));
const flags: boolean[] = [false, false, true];
function atFlag(list: boolean[], f: boolean) { return [list.indexOf(f), list.includes(f)].join(); }
console.log("booleans", atFlag(flags, true), atFlag(flags, false), atFlag([true], false));
const nulls: (Item | null)[] = [items[0], null, items[1]];
function atNull(list: (Item | null)[], v: Item | null) { return [list.indexOf(v), list.includes(v)].join(); }
console.log("null", atNull(nulls, null), atNull(nulls, items[1]), atNull([items[0]], null));
const functions: (() => number)[] = [() => 1, () => 2];
function atFunction(list: (() => number)[], f: () => number) { return [list.indexOf(f), list.includes(f)].join(); }
console.log("functions", atFunction(functions, functions[1]), atFunction(functions, () => 2));
const numbers: unknown[] = [1, 2, 3];
const doubles: unknown[] = [1.5, 2.5];
function atUnknownList(list: unknown[], item: Item) { return [list.indexOf(item), list.includes(item)].join(); }
console.log("storage of numbers", atUnknownList(numbers, other), atUnknownList(doubles, other));
numbers.push(other);
doubles.push(other);
console.log("storage that changed", atUnknownList(numbers, other), atUnknownList(doubles, other));
function from(list: Item[], item: Item, start: number) { return [list.indexOf(item, start), list.includes(item, start)].join(); }
console.log("from an index", from(items, items[3], 3), from(items, items[3], 4), from(items, items[39], -1), from(items, items[38], -1));
const grown: Item[] = [];
for (let i = 0; i < 100; i++) { grown.push({ i }); if (grown.indexOf(grown[i]) !== i || !grown.includes(grown[0])) console.log("wrong at", i); }
grown.length = 10;
console.log("cut", at(grown, grown[9]), grown.indexOf(items[0]));
class Odd extends Array<Item> {}
const odd = new Odd(); odd.push(items[0], items[1]);
console.log("a subclass", at(odd, items[1]), at(odd, other));
const proxied = new Proxy(items, {}) as Item[];
console.log("a proxy", at(proxied, items[2]));
function atMaybeUndefined(list: (Item | undefined)[], item: Item | undefined) { return [list.indexOf(item), list.includes(item)].join(); }
console.log("undefined is searched", atMaybeUndefined(holey, undefined), atMaybeUndefined([items[0], , items[1]], undefined), atMaybeUndefined([items[0], items[1]], undefined), atMaybeUndefined(items, undefined), atMaybeUndefined(holey, items[4]));
const longWithHole: (Item | undefined)[] = items.slice(); delete longWithHole[30];
console.log("a long array with a hole", atMaybeUndefined(longWithHole, undefined), atMaybeUndefined(longWithHole, items[39]), atMaybeUndefined(longWithHole, items[30]));
const mixed: unknown[] = [1, "two", 3n, items[0], null, undefined, true, Symbol.iterator, 2.5, "t" + "wo".slice(0), NaN, , -0];
function atAnything(list: unknown[], v: unknown) { let r = ""; for (let k = 0; k < 3; k++) r = [list.indexOf(v), list.includes(v)].join(); return r; }
console.log("anything is searched", [1, "two", 3n, items[0], null, undefined, true, false, Symbol.iterator, 2.5, NaN, 0, -0, "x", 4n, items[1], "tw" + "o"].map(v => atAnything(mixed, v)).join(" "));
const longMixed: unknown[] = mixed.concat(items, ["last", 7n, 9]);
console.log("anything in a long array", ["last", 7n, 9, items[39], undefined, NaN, "la" + "st", BigInt(7), 9.0, null].map(v => atAnything(longMixed, v)).join(" "));
