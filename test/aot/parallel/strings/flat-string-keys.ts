// A short concatenation of strings and numbers that is used as a lookup key in the same function is built as a flat string.
// CALLS+ getPair operationAOTConcatenate
// CALLS- getPair IntToString|DoubleToString
// CALLS+ hasTemplate operationAOTConcatenate
// CALLS+ cached operationAOTConcatenate
// CALLS+ addToSet operationAOTConcatenate
// CALLS+ throughJoin operationAOTConcatenate
// CALLS+ property operationAOTConcatenate
// CALLS- returned operationAOTConcatenate
// CALLS- pixels operationAOTConcatenate
// CALLS- asValue operationAOTConcatenate
// CALLS- pushed operationAOTConcatenate
// CALLS+ handled operationAOTConcatenate
// CALLS+ twoStrings operationAOTConcatenate
// CALLS+ templateOfStrings operationAOTConcatenate
// CALLS- threeStrings operationAOTConcatenate
const print = (s: string) => console.log(s);
function show(x: unknown): string {
    if (typeof x !== "string")
        return Object.is(x, -0) ? "-0" : String(x);
    let out = '"';
    for (let i = 0; i < x.length; i++) {
        const c = x.charCodeAt(i);
        out += c >= 32 && c < 127 ? x[i] : "\\u" + (c + 0x10000).toString(16).slice(1);
    }
    return out + '"';
}
function attempt(f: () => unknown): string {
    try {
        return show(f());
    } catch (e) {
        return "throws " + (e as Error).name;
    }
}
function cat(a: string, b: string): string { return a + b; }
function cat3(a: string, b: string, c: string): string { return `${a}${b}${c}`; }
function part(s: string, from: number, to: number): string { return s.slice(from, to); }
function flattened(s: string): string { s.charCodeAt(0); return s; }
interface T { id: number; name: string }
export function getPair(m: Map<string, number>, a: T, b: T): number | undefined { return m.get(a.id + "," + b.id); }
export function hasTemplate(m: Map<string, number>, a: T, b: T, postfix: string): boolean { return m.has(`${a.id},${b.id}${postfix}`); }
export function cached(m: Map<string, number>, a: T, b: T): number { const key = a.id + ":" + b.id; let found = m.get(key); if (found === undefined) { found = m.size; m.set(key, found); } return found; }
export function addToSet(s: Set<string>, a: T, n: number): number { s.add(a.name + "#" + n); return s.size; }
export function throughJoin(m: Map<string, number>, a: T, b: T, swap: boolean): number | undefined { let key: string; if (swap) key = b.id + "," + a.id; else key = a.id + "," + b.id; return m.get(key); }
export function property(o: Record<string, number>, a: T, b: T): number | undefined { return o[a.id + "_" + b.id]; }
export function returned(a: T, b: T): string { return a.id + "," + b.id; }
export function pixels(i: number): string { return `${i & 1023}px`; }
export function asValue(m: Map<number, string>, a: T, b: T): number { m.set(a.id, a.id + "," + b.id); return m.size; }
export function pushed(list: string[], a: T, b: T): number { return list.push(a.id + "," + b.id); }
export function handled(m: Map<string, number>, a: T, b: T): number | undefined { try { return m.get(a.id + "," + b.id); } catch { return -1; } }
export function threeStrings(m: Map<string, number>, a: T, b: T): number | undefined { return m.get(a.name + "," + b.name); }
// What is read from a field may be null or undefined to the IR, and `+` of such goes the general way: these two are strings for certain.
export function twoStrings(m: Map<string, number>, a: T, b: T): number | undefined { const x = `${a.name}`, y = `${b.name}`; return m.get(x + y); }
export function templateOfStrings(m: Map<string, number>, a: T, b: T): boolean { return m.has(`${a.name},${b.name}`); }
const numbers = [0, -0, 1, 9, 10, 1023, 1024, 65535, 123456, 2147483647, 2147483648, -1, -2147483648, -2147483649, 4294967295, 2 ** 53, 1e21, 1e-7, 0.1, -0.5, 1.5, NaN, Infinity, -Infinity, 5e-324];
const names = ["", "x", "@12", "caf\u00e9", "\u65e5\u672c", "a".repeat(40), "a".repeat(52), "a".repeat(53), "a".repeat(64), "a".repeat(200), cat("ab", "cd"), cat3("a", "b", "c"), part("xxabcdefxx", 2, 8), flattened(cat("fl", "at"))];
// Every key is entered as a text made otherwise, and found by the text made in one piece; and the other way round.
const m = new Map<string, number>(), s = new Set<string>(), o: Record<string, number> = {}, values = new Map<number, string>(), list: string[] = [];
let n = 0, bad = "";
for (const x of numbers) for (const y of numbers) { m.set([String(x), String(y)].join(","), n); o[[String(x), String(y)].join("_")] = n; for (const p of names) m.set([String(x), String(y)].join(",").concat(p), n); n++; }
n = 0;
for (const x of numbers) for (const y of numbers) {
    const a: T = { id: x, name: "n" }, b: T = { id: y, name: "m" };
    if (getPair(m, a, b) !== n) bad += " getPair " + x + " " + y;
    if (throughJoin(m, a, b, false) !== n || throughJoin(m, b, a, true) !== n) bad += " throughJoin " + x + " " + y;
    if (handled(m, a, b) !== n) bad += " handled " + x + " " + y;
    if (property(o, a, b) !== n) bad += " property " + x + " " + y;
    for (const p of names) if (!hasTemplate(m, a, b, p)) bad += " hasTemplate " + x + " " + y + " " + show(p.slice(0, 8));
    if (hasTemplate(m, a, b, "?")) bad += " hasTemplate finds what is not there";
    if (returned(a, b) !== [String(x), String(y)].join(",")) bad += " returned " + x + " " + y;
    n++;
}
print("differences:" + bad);
const fresh = new Map<string, number>(); let total = 0;
for (let round = 0; round < 3; round++) for (let i = 0; i < 400; i++) total += cached(fresh, { id: i * 37, name: "" }, { id: 100000 - i, name: "" });
print(fresh.size + " " + total + " " + fresh.get("37:99999") + " " + [...fresh.keys()].slice(0, 3).map(show).join());
for (const p of names) for (const x of numbers) addToSet(s, { id: 0, name: p }, x);
let inSet = 0; for (const p of names) for (const x of numbers) if (s.has(p.concat("#", String(x)))) inSet++;
print(s.size + " " + inSet);
for (let i = 0; i < 5; i++) { asValue(values, { id: i, name: "" }, { id: i * i, name: "" }); pushed(list, { id: i, name: "" }, { id: -i, name: "" }); }
print([...values.values()].map(show).join() + " " + list.map(show).join() + " " + pixels(5) + pixels(2047) + pixels(-1));
print(String(threeStrings(new Map([["n,m", 7]]), { id: 0, name: "n" }, { id: 0, name: "m" })));
{ const byName = new Map<string, number>(); let k = 0, wrong = ""; for (const p of names) for (const q of names) { byName.set([p, q].join(""), k); byName.set([p, q].join(","), k); k++; }
  for (const p of names) for (const q of names) { const a: T = { id: 0, name: p }, b: T = { id: 0, name: q }; if (twoStrings(byName, a, b) !== byName.get(p.concat(q))) wrong += " two " + show(p.slice(0, 6)) + show(q.slice(0, 6)); if (!templateOfStrings(byName, a, b)) wrong += " template " + show(p.slice(0, 6)) + show(q.slice(0, 6)); }
  const empty: T = { id: 0, name: "" }, alsoEmpty: T = { id: 0, name: part("xx", 1, 1) }; print("strings:" + wrong + " " + twoStrings(byName, empty, alsoEmpty) + " " + (empty.name + alsoEmpty.name === "") + " " + byName.size); }
(globalThis as any).kept = [getPair, hasTemplate, cached, addToSet, throughJoin, property, returned, pixels, asValue, pushed, handled, threeStrings, twoStrings, templateOfStrings]; console.log("number");
