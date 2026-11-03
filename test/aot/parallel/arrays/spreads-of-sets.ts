// `[...set]` in every place a spread can stand, over sets of every make: small and large, with members taken out, of numbers, texts, objects and a mix,
// written out in the program or filled at run time, and where a set has a walk of its own.
const show = (label: string, list: unknown[]) => console.log(label, list.length, JSON.stringify(list.length > 12 ? [...list.slice(0, 4), "..", ...list.slice(-4)] : list));
const numbers = (count: number, from = 0) => { const set = new Set<number>(); for (let n = 0; n < count; n++) set.add(from + n); return set; };

for (const count of [0, 1, 2, 4, 5, 8, 9, 16, 17, 100, 255, 256, 1000, 70000]) show("numbers " + count, [...numbers(count)]);
show("fractions", [...new Set([0.5, 1.5, -0, 0, NaN, NaN, Infinity])]);
show("large numbers", [...new Set([2 ** 31, 2 ** 32, 2 ** 53, -(2 ** 31) - 1])]);
show("texts", [...new Set(["a", "b", "a", "", "long text that is no literal ".repeat(2)])]);
show("a mix", [...new Set<unknown>([1, "1", null, undefined, true, 1n.toString(), { a: 1 }, [2], 1.5])]);
const written = new Set(["red", "green", "blue"]);
show("written out", [...written]);
show("written out, twice", [...written, ...written]);

const holes = numbers(10);
for (const n of [0, 3, 4, 9]) holes.delete(n);
show("members taken out", [...holes]);
holes.add(3);
show("one put back", [...holes]);
holes.clear();
show("cleared", [...holes]);
holes.add(7);
show("filled again", [...holes]);
const emptied = numbers(300);
for (let n = 0; n < 299; n++) emptied.delete(n);
show("nearly emptied", [...emptied]);

show("in the middle", [-1, ...numbers(3), -2]);
show("behind a list", [...[9, 8], ...numbers(3)]);
show("two sets", [...numbers(3), ...numbers(2, 10)]);
show("a set and a text", [...numbers(2), ..."ab"]);
const collect = (...all: number[]) => all;
show("as arguments", collect(...numbers(4)));
show("as arguments behind one", collect(0, ...numbers(2, 5)));
show("Math.max", [Math.max(...numbers(50))]);
show("new Array", new Array(...numbers(3, 1)));
show("Array.from", Array.from(numbers(5)));
show("Array.from with a mapper", Array.from(numbers(5), n => n * 2));
show("without doubles", [...new Set([3, 1, 3, 2, 1])]);
show("keys", [...numbers(3).keys()]);
show("values", [...numbers(3).values()]);
show("entries", [...numbers(2).entries()]);

// The list is the program's own: what it stores there does not reach the set, and the other way round.
const source = numbers(3);
const copy = [...source];
copy.push(99);
source.add(50);
show("the copy", copy);
show("the source", [...source]);
const objects = new Set([{ n: 1 }, { n: 2 }]);
const same = [...objects];
console.log("the same objects", same.every(o => objects.has(o)));

// The kind of list that comes out takes whatever is stored next.
const grown = [...numbers(3)] as unknown[];
grown.push(0.5, "text", { a: 1 });
show("grown", grown);
const sparse = [...numbers(2)];
sparse[5] = 1;
console.log("sparse", sparse.length, 3 in sparse, Object.keys(sparse).join());

class Counted extends Set<number> {
  [Symbol.iterator](): SetIterator<number> {
    const inner = super.values();
    return { next: () => { const step = inner.next(); return step.done ? step : { done: false, value: step.value * 10 }; }, [Symbol.iterator]() { return this; } } as SetIterator<number>;
  }
}
show("a subclass with a walk of its own", [...new Counted([1, 2, 3])]);
class Plain extends Set<number> {}
show("a subclass without", [...new Plain([1, 2, 3])]);
const own = numbers(3);
(own as any)[Symbol.iterator] = function* () { yield "own"; };
show("a walk of its own", [...own]);

function spread(set: Set<number>) { return [...set]; }
for (let turn = 0; turn < 3; turn++) show("in a function " + turn, spread(numbers(turn + 2)));

// Array.from of a set is the same list.
for (const count of [0, 1, 5, 8, 100, 70000]) show("Array.from " + count, Array.from(numbers(count)));
show("Array.from texts", Array.from(written));
show("Array.from members taken out", Array.from(emptied));
show("Array.from a subclass with a walk of its own", Array.from(new Counted([1, 2, 3])));
show("Array.from a subclass without", Array.from(new Plain([1, 2, 3])));
show("Array.from a walk of its own", Array.from(own));
function from(set: Set<number>) { return Array.from(set); }
for (let turn = 0; turn < 3; turn++) show("Array.from in a function " + turn, from(numbers(turn + 2)));
function fromEither(items: Set<number> | number[] | { length: number; 0: number }) { return Array.from(items); }
show("Array.from a set or a list", [fromEither(numbers(2)), fromEither([7, 8]), fromEither({ length: 1, 0: 5 })]);
