// for-of, spread and destructuring over iterators whose `next` is the built-in's own, another built-in's, or the program's.
function* numbers(to: number) { for (let i = 0; i < to; i++) yield i; }
function total(values: Iterable<number>): number { let sum = 0; for (const value of values) sum += value; return sum; }
const borrowed = { [Symbol.iterator]() { const inner = [7, 8][Symbol.iterator](); return { next: inner.next.bind(inner) }; } };
const swapped = { [Symbol.iterator]() { const inner = new Set([5, 6]).values(); const outer = [1, 2, 3][Symbol.iterator](); (outer as any).next = () => inner.next(); return outer; } };
const written = { [Symbol.iterator]() { let left = 3; return { next() { return left-- ? { value: left, done: false } : { value: undefined, done: true }; } }; } };
const mixed = { [Symbol.iterator]() { const list = [1, 2, 3][Symbol.iterator](); const map = new Map([[1, 1]]).keys(); return { next: (map as any).next, __proto__: list } as any; } };
for (let turn = 0; turn < 3; turn++) {
    console.log(total([1, 2, 3]), total(new Set([4, 5])), total(new Map([[1, 2]]).keys()), total(numbers(5)), total([1, 2, 3].values()), total(new Set([1]).values()));
    console.log(total(borrowed as any), total(swapped as any), total(written as any));
    try { console.log(total(mixed as any)); } catch (error) { console.log((error as Error).name); }
    console.log([...numbers(3)], [..."a\u{1F600}b"].length, [...new Map([[1, 2]])], Array.from(numbers(2)), Math.max(...new Set([3, 9])));
    const [first, , third = 30, ...rest] = numbers(6); console.log(first, third, rest);
    const [one, two] = written as any; console.log(one, two);
}
