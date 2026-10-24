declare const console: { log(...values: unknown[]): void };
function show(v: unknown): string { return typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : String(v); }
const given: number[] = [0, -0, 1, -1, 7, 2.5, -2.5, 2147483647, -2147483648, 2147483648, -2147483649, 4294967295, 4294967296, 9007199254740991, 1e21, 5e-324, Infinity, -Infinity, NaN];
function holed(): number[] { const a = given.slice(); delete (a as unknown[])[3]; a.length = a.length + 2; return a; }
function wholes(): (number | undefined)[] { return [0, 1, undefined, 2147483647, -2147483648, 4294967296, 9007199254740991, undefined]; }
function fill(m: Map<number | undefined, string>, a: number[]): void { for (let i = 0; i < a.length; i++) m.set(a[i], "s" + i); }
function fillBoxed(m: Map<unknown, string>, a: unknown[]): void { for (let i = 0; i < a.length; i++) m.set(a[i], "b" + i); }
function getAll(m: Map<number | undefined, string>, a: number[]): string { let s = ""; for (let i = 0; i < a.length + 1; i++) s += String(m.get(a[i])) + " "; return s; }
function hasAll(m: Map<number | undefined, string>, a: number[]): string { let s = ""; for (let i = 0; i < a.length + 1; i++) s += m.has(a[i]) ? "y" : "n"; return s; }
function getOne(m: Map<number | undefined, string>, a: number[], i: number): string | undefined { return m.get(a[i]); }
function hasOne(s: Set<number | undefined>, a: number[], i: number): boolean { return s.has(a[i]); }
function addAll(s: Set<number | undefined>, a: number[]): void { for (let i = 0; i < a.length; i++) s.add(a[i]); }
function setHasAll(s: Set<number | undefined>, a: number[]): string { let t = ""; for (let i = 0; i < a.length + 1; i++) t += s.has(a[i]) ? "y" : "n"; return t; }
function deleteAll(m: Map<number | undefined, string>, a: number[]): string { let t = ""; for (let i = 0; i < a.length + 1; i++) t += m.delete(a[i]) ? "y" : "n"; return t; }
function wholeKeys(m: Map<number | undefined, string>, a: (number | undefined)[]): string { let s = ""; for (let i = 0; i < a.length; i++) { const k = a[i]; m.set(k === undefined ? undefined : k | 0, "w" + i); s += String(m.get(k === undefined ? undefined : k | 0)) + " "; } return s; }
function places(a: number[], keys: number[]): string { let s = ""; for (let i = 0; i < keys.length + 1; i++) s += a.indexOf(keys[i]) + "," + (a.includes(keys[i]) ? "y" : "n") + " "; return s; }
function counts(a: number[]): string { const m = new Map<number | undefined, number>(); for (let r = 0; r < 3; r++) for (let i = 0; i < a.length; i++) { const k = a[i]; const n = m.get(k); m.set(k, n === undefined ? 1 : n + 1); } let s = ""; for (const [k, n] of m) s += show(k) + ":" + n + " "; return s + m.size; }
for (let turn = 0; turn < 2; turn++) {
    for (const [name, make] of [["given", () => given.slice()], ["holed", holed], ["parsed", () => JSON.parse("[0,1,-1,7,2147483647,-2147483648]") as number[]], ["none", (): number[] => []]] as [string, () => number[]][]) {
        const a = make(), m = new Map<number | undefined, string>(), s = new Set<number | undefined>();
        fill(m, a); addAll(s, a);
        console.log(name + ": " + m.size + " " + s.size + " | " + getAll(m, a) + "| " + hasAll(m, a) + " " + setHasAll(s, a) + " | " + [...m.keys()].map(show).join() + " | " + [...s].map(show).join());
        console.log("  against given: " + getAll(m, given) + "| " + hasAll(m, given) + " " + setHasAll(s, given) + " | one: " + [0, 1, 3, 18, 99].map(i => String(getOne(m, given, i)) + (hasOne(s, given, i) ? "y" : "n")).join(" "));
        const boxed = new Map<unknown, string>();
        fillBoxed(boxed, [0, -0, 1, 2.5, NaN, undefined, null, "1", 2147483648, 1e21]);
        console.log("  filled boxed: " + getAll(boxed as Map<number | undefined, string>, a) + "| " + hasAll(boxed as Map<number | undefined, string>, a));
        console.log("  counts: " + counts(a) + " | places: " + places(a, given));
        console.log("  deleted: " + deleteAll(m, given) + " " + m.size + " " + deleteAll(m, a) + " " + m.size);
    }
    console.log(wholeKeys(new Map(), wholes()));
}
