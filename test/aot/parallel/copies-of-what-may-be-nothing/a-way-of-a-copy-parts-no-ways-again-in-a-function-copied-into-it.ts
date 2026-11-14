// Four functions, each of which spreads a source of its own that may be undefined and calls the next: the ways part once. A function that is copied into a way parts no ways again: they doubled at each level (48 at four levels).
// STATISTIC: ObjectSpreadsSplitOnEmptiness >= 1
// STATISTIC: ObjectSpreadsSplitOnEmptiness <= 2
type More = { p: number } | undefined;
function f0(a: number, m0: More, m1: More, m2: More, m3: More, m4: More) { const o: any = { a, ...m0 }; return o.a; }
function f1(a: number, m0: More, m1: More, m2: More, m3: More, m4: More) { const o: any = { a, ...m1 }; return f0(o.a + 1, m0, m1, m2, m3, m4); }
function f2(a: number, m0: More, m1: More, m2: More, m3: More, m4: More) { const o: any = { a, ...m2 }; return f1(o.a + 1, m0, m1, m2, m3, m4); }
function f3(a: number, m0: More, m1: More, m2: More, m3: More, m4: More) { const o: any = { a, ...m3 }; return f2(o.a + 1, m0, m1, m2, m3, m4); }
function f4(a: number, m0: More, m1: More, m2: More, m3: More, m4: More) { const o: any = { a, ...m4 }; return f3(o.a + 1, m0, m1, m2, m3, m4); }
const one = { p: 1 };
let s = 0; for (let i = 0; i < 100; i++) s += f4(i & 7, (i >> 0) & 1 ? one : undefined, (i >> 1) & 1 ? one : undefined, (i >> 2) & 1 ? one : undefined, (i >> 3) & 1 ? one : undefined, (i >> 4) & 1 ? one : undefined); console.log(s);
