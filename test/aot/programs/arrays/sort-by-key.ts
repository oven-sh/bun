// xs.sort((a, b) => a.k - b.k), (a, b) => a.k < b.k ? -1 : a.k > b.k ? 1 : 0, (a, b) => a.k.localeCompare(b.k), the same on the elements themselves, and each the other way round. Such a comparator only orders two keys. It runs no code of the program when every key is an element or an own data property of one, and all keys are numbers, or all are strings. With no NaN among them it is also consistent, so every stable sort gives the same result and nobody can tell how often it was called. Everything else is here too: a NaN, a hole, a getter, an inherited key, keys of two kinds, null, and a comparator that is not consistent, like a.k < b.k ? -1 : 1.
interface Row { k: number; at: number }
let seed = 7;
function next(): number { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed; }
const show = (v: unknown): string => Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
const list = (a: readonly unknown[]): string => { const out: string[] = []; for (let i = 0; i < a.length; i++) out.push(i in a ? show(a[i]) : "hole"); return out.join(" "); };
const attempt = (what: string, run: () => readonly unknown[]): void => { try { console.log(what + ":", list(run())); } catch (error: any) { console.log(what + ":", error.constructor.name); } };

attempt("whole numbers", () => [5, 3, 9, 1, 3, -2, 0].sort((a, b) => a - b));
attempt("whole numbers, falling", () => [5, 3, 9, 1, 3, -2, 0].sort((a, b) => b - a));
attempt("fractions", () => [5.5, 3.25, 9.75, 1.5, -2.5].sort((a, b) => a - b));
attempt("fractions, falling", () => [5.5, 3.25, 9.75, 1.5, -2.5].sort((a, b) => b - a));
attempt("both zeros keep their order", () => [0.5, -0, 0, -0, 0, -0.5].sort((a, b) => a - b));
attempt("both zeros keep their order, falling", () => [0.5, -0, 0, -0, 0, -0.5].sort((a, b) => b - a));
attempt("infinities", () => [1, Infinity, -Infinity, Infinity, 0, -Infinity].sort((a, b) => a - b));
attempt("huge and tiny", () => [1e308, -1e308, 5e-324, -5e-324, 0, 1e308].sort((a, b) => a - b));
attempt("mixed whole and fraction", () => { const a: number[] = [3, 1.5, 2, 0.5]; a.push(7); return a.sort((x, y) => x - y); });
attempt("none", () => ([] as number[]).sort((a, b) => a - b));
attempt("one", () => [4].sort((a, b) => a - b));
attempt("undefined goes last", () => [3, undefined, 1, undefined, 2].sort((a: any, b: any) => a - b));

const rows: Row[] = [];
for (let i = 0; i < 40; i++) rows.push({ k: next() % 7, at: i });
attempt("records, equal keys keep their order", () => rows.slice().sort((a, b) => a.k - b.k).map(r => r.k + ":" + r.at));
attempt("records, falling", () => rows.slice().sort((a, b) => b.k - a.k).map(r => r.k + ":" + r.at));
attempt("toSorted", () => rows.toSorted((a, b) => a.k - b.k).map(r => r.k + ":" + r.at));
attempt("toSorted leaves the array", () => rows.map(r => r.at));
console.log("toSorted makes an array:", rows.toSorted((a, b) => a.k - b.k) !== rows, rows.sort((a, b) => a.at - b.at) === rows);
const big: Row[] = [];
const byQuarter: number[][] = [];
for (let quarter = 0; quarter < 1000; quarter++) byQuarter.push([]);
for (let i = 0; i < 5000; i++) { const quarter = next() % 1000; big.push({ k: quarter / 4, at: i }); byQuarter[quarter]!.push(i); }
big.sort((a, b) => a.k - b.k);
const wanted = byQuarter.flat();
console.log("five thousand:", big.length === wanted.length, big.filter((row, place) => row.at !== wanted[place]).length, big[0]!.at, big[2500]!.at, big[4999]!.at);

const plain: any[] = JSON.parse('[{"k":3,"n":"a"},{"k":1,"n":"b"},{"k":2,"n":"c"},{"k":1,"n":"d"}]');
attempt("plain objects", () => plain.slice().sort(function (a: any, b: any): any { return a.k - b.k; }));
attempt("plain objects of several shapes", () => [{ k: 3 }, { z: 0, k: 1 }, { k: 2, y: 1 }, { x: 1, y: 2, k: 0 }].sort((a: any, b: any) => a.k - b.k));

let calls = 0;
attempt("NaN among the numbers", () => [3, NaN, 1, 2, NaN, 0, -1, 5, 4].sort((a, b) => a - b));
attempt("NaN among the numbers, toSorted", () => [3, NaN, 1, 2, NaN, 0, -1, 5, 4].toSorted((a, b) => a - b));
attempt("NaN among the keys", () => [{ k: 3 }, { k: NaN }, { k: 1 }, { k: 2 }].sort((a, b) => a.k - b.k));
attempt("holes", () => { const a = [3, 1, 2, 5, 4]; delete a[1]; return a.sort((x, y) => x - y); });
attempt("holes among records", () => { const a: any[] = [{ k: 3 }, { k: 1 }, { k: 2 }]; delete a[1]; return a.sort((x: any, y: any) => x.k - y.k); });
attempt("a getter", () => { const a: any[] = [{ k: 3 }, { get k() { calls++; return 1; } }, { k: 2 }]; return a.sort((x: any, y: any) => x.k - y.k).map((o: any) => o.k); });
console.log("the getter ran:", calls > 0);
attempt("an inherited key", () => [{ k: 3 }, Object.create({ k: 1 }), { k: 2 }].sort((x: any, y: any) => x.k - y.k).map((o: any) => o.k));
attempt("a missing key", () => [{ k: 3 }, { j: 1 }, { k: 2 }, { k: 1 }].sort((x: any, y: any) => x.k - y.k));
attempt("keys that are text", () => [{ k: "10" }, { k: "9" }, { k: "100" }].sort((x: any, y: any) => x.k - y.k));
attempt("text", () => (["10", "9", "100"] as any[]).sort((x: any, y: any) => x - y));
attempt("null among records", () => ([{ k: 3 }, null, { k: 2 }] as any[]).sort((x: any, y: any) => x.k - y.k));
attempt("numbers among records", () => ([{ k: 3 }, 5, { k: 2 }] as any[]).sort((x: any, y: any) => x.k - y.k));
attempt("objects with valueOf", () => ([{ valueOf() { calls++; return 2; } }, { valueOf() { calls++; return 1; } }] as any[]).sort((x: any, y: any) => x - y).map((o: any) => +o));
attempt("a proxy among records", () => ([{ k: 3 }, new Proxy({ k: 1 }, { get(t: any, p: any) { calls++; return t[p]; } }), { k: 2 }] as any[]).sort((x: any, y: any) => x.k - y.k).map((o: any) => o.k));
console.log("code of the program ran:", calls > 3);
attempt("a frozen array", () => (Object.freeze([3, 1, 2]) as number[]).sort((a, b) => a - b));
attempt("a frozen array, toSorted", () => Object.freeze([3, 1, 2]).toSorted((a, b) => a - b));
class Numbers extends Array<number> {}
attempt("a subclass", () => { const a = Numbers.from([3, 1, 2]); const s = a.sort((x, y) => x - y); return [...s, s instanceof Numbers ? 1 : 0]; });
attempt("a subclass, toSorted", () => { const s = Numbers.from([3, 1, 2]).toSorted((x, y) => x - y); return [...s, s instanceof Numbers ? 1 : 0]; });
attempt("an array-like", () => Array.from(Array.prototype.sort.call({ length: 3, 0: 3, 1: 1, 2: 2 }, (x: any, y: any) => x - y) as any));

let seen = 0;
attempt("other comparators are called", () => [3, 1, 2].sort((a, b) => { seen++; return a - b; }));
attempt("two names", () => [{ k: 3, j: 1 }, { k: 1, j: 3 }, { k: 2, j: 2 }].sort((a, b) => a.k - b.j));
attempt("one parameter twice", () => [{ k: 3 }, { k: 1 }, { k: 2 }].sort((a, _b) => a.k - a.k));
attempt("a sum", () => [3, 1, 2].sort((a, b) => a + b));
console.log("it was called:", seen > 0);

interface Named { name: string; k: number; at: number }
const people: Named[] = [];
const words = ["pear", "Apple", "fig", "apple", "", "Zoo", "zoo", "fig", "\u00e9clair", "eclair", "a\uD83D\uDE42", "a\uFFFD", "10", "9"];
for (let i = 0; i < words.length; i++) people.push({ name: words[i]!, k: (i * 5) % 4, at: i });
const names = (a: readonly Named[]): string[] => a.map(p => JSON.stringify(p.name) + p.at);
attempt("three ways, numbers", () => [5, 3, 9, 1, 3].sort((a, b) => a < b ? -1 : a > b ? 1 : 0));
attempt("three ways, greater first", () => [5, 3, 9, 1, 3].sort((a, b) => a > b ? 1 : a < b ? -1 : 0));
attempt("three ways, falling", () => [5, 3, 9, 1, 3].sort((a, b) => a < b ? 1 : a > b ? -1 : 0));
attempt("three ways, operands swapped", () => [5, 3, 9, 1, 3].sort((a, b) => b > a ? -1 : b < a ? 1 : 0));
attempt("three ways, equal first", () => [5, 3, 9, 1, 3].sort((a, b) => a === b ? 0 : a < b ? -1 : 1));
attempt("three ways, not equal", () => [5, 3, 9, 1, 3].sort((a, b) => a !== b ? (a < b ? -1 : 1) : 0));
attempt("three ways, statements", () => [5, 3, 9, 1, 3].sort((a, b) => { if (a < b) return -1; if (a > b) return 1; return 0; }));
attempt("three ways, at most and at least", () => [5, 3, 9, 1, 3].sort((a, b) => a <= b ? (a >= b ? 0 : -7) : 2.5));
attempt("three ways, keys", () => people.slice().sort((a, b) => a.k < b.k ? -1 : a.k > b.k ? 1 : 0).map(p => p.k + ":" + p.at));
attempt("three ways, text", () => words.slice().sort((a, b) => a < b ? -1 : a > b ? 1 : 0).map(w => JSON.stringify(w)));
attempt("three ways, text, falling", () => words.slice().sort((a, b) => a < b ? 1 : a > b ? -1 : 0).map(w => JSON.stringify(w)));
attempt("three ways, text keys", () => names(people.slice().sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)));
attempt("three ways, text keys, toSorted", () => names(people.toSorted((a, b) => a.name > b.name ? -1 : a.name < b.name ? 1 : 0)));
attempt("three ways, text made of pieces", () => ["b", "a", "c"].map((w, i) => w + "x".repeat(i + 1) + w).sort((a, b) => a < b ? -1 : a > b ? 1 : 0));
attempt("by locale", () => words.slice().sort((a, b) => a.localeCompare(b)).map(w => JSON.stringify(w)));
attempt("by locale, falling", () => words.slice().sort((a, b) => b.localeCompare(a)).map(w => JSON.stringify(w)));
attempt("by locale, keys", () => names(people.slice().sort((a, b) => a.name.localeCompare(b.name))));
attempt("by locale, keys, toSorted", () => names(people.toSorted((a, b) => b.name.localeCompare(a.name))));
attempt("numbers and text among the keys", () => ([{ k: 2 }, { k: "10" }, { k: 1 }, { k: "9" }] as any[]).sort((a: any, b: any) => a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
attempt("NaN, three ways", () => [3, NaN, 1, 2, NaN, 0].sort((a, b) => a < b ? -1 : a > b ? 1 : 0));
attempt("text, by difference", () => (["10", "9", "100"] as any[]).sort((a: any, b: any) => a - b));
attempt("numbers, by locale", () => ([3, 1, 2] as any[]).sort((a: any, b: any) => a.localeCompare(b)));
attempt("objects with their own localeCompare", () => ([{ n: 2, localeCompare(o: any) { calls++; return this.n - o.n; } }, { n: 1, localeCompare(o: any) { calls++; return this.n - o.n; } }] as any[]).sort((a: any, b: any) => a.localeCompare(b)).map((o: any) => o.n));
attempt("by locale with a locale", () => ["b", "a", "c"].sort((a, b) => a.localeCompare(b, "en")));
attempt("never equal", () => people.slice().sort((a, b) => a.k < b.k ? -1 : 1).map(p => p.k + ":" + p.at).slice(0, 0).concat("ran"));
attempt("a truth value", () => ([5, 3, 9, 1, 3] as any[]).sort(function (a: any, b: any): any { return a > b; }).slice(0, 0).concat(1));
attempt("always zero", () => [5, 3, 9, 1, 3].sort((_a, _b) => 0));
attempt("the same way for both", () => [5, 3, 9].sort((a, b) => a < b ? -1 : a > b ? -1 : 0).slice(0, 0).concat(1));
