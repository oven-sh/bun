// String methods called in code without type annotations, where the receiver and the arguments can be anything.
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
const log: string[] = [];
function watched(name: string, value: unknown): any { return { valueOf() { log.push(name + ".valueOf"); return value; }, toString() { log.push(name + ".toString"); return String(value); } }; }
export function unit(s: any, i: any): any { return s.charCodeAt(i); }
export function point(s: any, i: any): any { return s.codePointAt(i); }
export function charAt(s: any, i: any): any { return s.charAt(i); }
export function at(s: any, i: any): any { return s.at(i); }
export function slice(s: any, a: any, b: any): any { return s.slice(a, b); }
export function slice1(s: any, a: any): any { return s.slice(a); }
export function substring(s: any, a: any, b: any): any { return s.substring(a, b); }
export function includes(s: any, t: any): any { return s.includes(t); }
export function includesFrom(s: any, t: any, i: any): any { return s.includes(t, i); }
export function indexOf(s: any, t: any): any { return s.indexOf(t); }
export function lastIndexOf(s: any, t: any): any { return s.lastIndexOf(t); }
export function startsWith(s: any, t: any): any { return s.startsWith(t); }
export function endsWith(s: any, t: any, i: any): any { return s.endsWith(t, i); }
export function concat(s: any, t: any): any { return s.concat(t); }
export function text(s: any): any { return s.toString(); }
function shown(x: unknown): string { return Array.isArray(x) ? "[" + x.map(shown).join() + "]" : typeof x === "object" && x !== null ? "{" + Object.keys(x).join() + "}" : show(x); }
function tried(f: () => unknown): string { const before = log.length; let out: string; try { out = shown(f()); } catch (e) { out = "throws " + (e as Error).name; } return out + (log.length > before ? "<" + log.splice(before).join() + ">" : ""); }
const receivers: any[] = ["", "a", "abcdef", "café", "a\u{1f600}b", cat("abc", "def"), part("xxabcdefxx", 2, 8), new String("abcdef"), [1, 2, 3, "c", "cd"], ["abcdef"], new Uint8Array([1, 2, 3]), 12345, true, undefined, null, Symbol.iterator, 10n,
    { charCodeAt: (i: any) => "mine" + typeof i, codePointAt: () => "mine", charAt: () => "mine", at: () => "mine", slice: (a: any, b: any) => "mine" + typeof a + typeof b, substring: () => "mine", includes: () => "mine", indexOf: () => "mine", lastIndexOf: () => "mine", startsWith: () => "mine", endsWith: () => "mine", concat: () => "mine", toString: () => "mine" }, {}, watched("r", "abcdef")];
const numbers: any[] = [0, 1, 2, 5, 6, -1, -2, -0, 1.5, NaN, Infinity, -Infinity, 2 ** 31, 2 ** 53, undefined, null, true, false, "1", "x", "", [], [2], {}, watched("n", 2), watched("m", "1"), Symbol.iterator, 1n];
const texts: any[] = ["", "a", "c", "cd", "f", "def", "abcdef", "abcdefg", "é", "\u{1f600}", "\ud83d", cat("c", "d"), 1, 2, 12, NaN, undefined, null, true, [], ["c"], {}, watched("t", "cd"), /c/, Symbol.iterator, 3n];
for (const s of receivers) {
    let line = tried(() => String(typeof s === "symbol" ? "symbol" : typeof s === "object" && s !== null ? Object.prototype.toString.call(s) : s)) + ":";
    for (const i of numbers) line += " " + tried(() => unit(s, i)) + "," + tried(() => point(s, i)) + "," + tried(() => charAt(s, i)) + "," + tried(() => at(s, i)) + "," + tried(() => slice1(s, i));
    print(line);
    line = "  parts:"; for (const a of numbers) for (const b of [1, 4, -1, undefined, "3", watched("b", 3)]) line += " " + tried(() => slice(s, a, b)) + "," + tried(() => substring(s, a, b));
    print(line);
    line = "  texts:"; for (const t of texts) line += " " + tried(() => includes(s, t)) + "," + tried(() => indexOf(s, t)) + "," + tried(() => lastIndexOf(s, t)) + "," + tried(() => startsWith(s, t)) + "," + tried(() => concat(s, t)) + "," + tried(() => includesFrom(s, t, 2)) + "," + tried(() => includesFrom(s, t, watched("i", 1))) + "," + tried(() => endsWith(s, t, 4));
    print(line + " " + tried(() => text(s)));
}
(globalThis as any).kept = [unit, point, charAt, at, slice, slice1, substring, includes, includesFrom, indexOf, lastIndexOf, startsWith, endsWith, concat, text]; console.log("number");
