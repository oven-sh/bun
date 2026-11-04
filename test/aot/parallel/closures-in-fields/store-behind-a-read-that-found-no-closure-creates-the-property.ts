// The read finds the slot empty, and the store behind it is what creates the property: it is listed from then on, behind the names that the object had.
type Options = { name: string; isExpected?: (e: unknown) => boolean; last?: number };
const kept: Options[] = [];
function one(k: number): Options { let n = k; const o: Options = { name: "a", isExpected: e => { n++; return n > 1; } }; kept.push(o); return o; }
function two(): Options { const o: Options = { name: "b" }; kept.push(o); return o; }
const a = one(0), b = two();
b.last = 1;
const before = b.isExpected;
b.isExpected = () => true;
console.log(typeof before, typeof b.isExpected, Object.keys(b).join(), JSON.stringify(b), "isExpected" in b, Object.keys(a).join(), b.isExpected(0), a.isExpected!(0));
function later(options: Options): string { const found = options.isExpected; options.isExpected = undefined; return typeof found + ":" + Object.keys(options).join(); }
console.log(later(two()), later(one(5)), later(b));
