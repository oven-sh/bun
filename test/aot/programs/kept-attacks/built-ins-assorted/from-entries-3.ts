// Built ins assorted: from entries. It prints what plain Bun prints.
function* generated(): Generator<[string | symbol, number]> { yield ["g", 1]; yield [Symbol.iterator, 2]; }
const iterable = { [Symbol.iterator]() { return ([["i", 1]] as [string, number][])[Symbol.iterator](); } };
console.log(JSON.stringify(Object.fromEntries([["first", 1], ["second", "two"]])));
console.log(JSON.stringify(Object.fromEntries(new Map([["a", 1], ["b", 2]]))));
const made = Object.fromEntries(generated()) as any;
console.log(made.g, made[Symbol.iterator]);
console.log(JSON.stringify(Object.fromEntries(iterable)));
console.log(Object.keys(Object.fromEntries([])).length, Object.getPrototypeOf(Object.fromEntries([])) === Object.prototype);
console.log(JSON.stringify(Object.fromEntries([[1, "a"], ["0", "b"], [1, "c"]])));
const grown = Object.fromEntries([["a", 1]]) as any; grown.b = 2; delete grown.a; console.log(JSON.stringify(grown));
try { Object.fromEntries([1] as any); } catch (e) { console.log((e as Error).name, (e as Error).message); }
const groups = Object.groupBy([1, 2, 3], n => (n % 2 ? "odd" : "even")); console.log(JSON.stringify(groups), Object.getPrototypeOf(groups));
