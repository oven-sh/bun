// A set of a list of objects holds each of them once, in their order.
let failures = 0;
const check = (name, found, expected) => { if (!Object.is(found, expected) && ++failures < 20) console.log(name, "is", found, "and not", expected); };
class Point { constructor(x) { this.x = x; } }
const make = i => i % 5 === 0 ? { i } : i % 5 === 1 ? [i] : i % 5 === 2 ? new Point(i) : i % 5 === 3 ? () => i : new Map([[i, i]]);
const unique = list => [...new Set(list)];
for (const length of [1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 100, 255, 256, 300, 1000, 70000]) {
    const objects = Array.from({ length }, (_, i) => make(i));
    for (const step of [1, 2, 3, length]) {
        const list = [], expected = [];
        for (let i = 0; i < 2 * length; ++i) list.push(objects[(i * step) % length]);
        for (const object of list) if (!expected.mark) expected.mark = new Map(), expected.mark.set(object, 1), expected.push(object); else if (!expected.mark.has(object)) expected.mark.set(object, 1), expected.push(object);
        const found = unique(list), set = new Set(list);
        check("length " + length + " " + step, found.length, expected.length);
        for (let i = 0; i < expected.length; ++i) if (found[i] !== expected[i]) { check("element " + i + " of " + length, 0, 1); break; }
        check("has " + length, expected.every(object => set.has(object)), true);
        const other = make(1);
        check("has not " + length, set.has(other), false);
        set.add(other);
        check("added " + length, set.size === expected.length + 1 && set.has(other), true);
        check("deleted " + length, set.delete(list[0]) && !set.has(list[0]) && set.size === expected.length, true);
        check("gone " + length, set.delete(list[0]), false);
        if (globalThis.Bun && length < 300) Bun.gc(true);
        let count = 0;
        for (const object of set) if (object === other || expected.includes(object)) ++count; else if (length > 1000) break;
        if (length <= 1000) check("walked " + length, count, expected.length);
    }
}
const o = {}, s = Symbol("s");
check("mixed", unique([o, 1, "a", o, 1, "a", s, null, undefined, NaN, NaN, 0, -0, s, true]).length, 9);
check("hole", unique([o, , o, undefined]).length, 2);
check("null first", unique([null, o, null, o]).length, 2);
check("proxy", unique([new Proxy(o, {}), o, o]).length, 2);
check("frozen", unique(Object.freeze([o, o, { o }])).length, 2);
class Other extends Set { add(value) { super.add(value); this.added = (this.added || 0) + 1; return this; } }
check("subclass", new Other([o, o, {}]).added, 3);
const array = [o, o];
array[Symbol.iterator] = function* () { yield 1; yield 2; yield 3; };
check("own iterator", new Set(array).size, 3);
console.log(failures);
