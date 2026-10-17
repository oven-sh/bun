// `===` and `!==` between values of unknown type: every pair of kinds of values.
// CALLS+ sameUnknown StrictEqual
// CALLS- isKind StrictEqual
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
function fresh(s: string): string { return Array.from(s).join(""); }
function wide(s: string): string { return flattened(("\u65e5" + s).slice(1)); }
const texts = ["", "a", "b", "ab", "ac", "bb", "abcdefg", "abcdefh", "bbcdefg", "abcdefgh", "abcdefgi", "bbcdefgh", "abcdefghi", "abcdefghj", "abcdefgxi", "bbcdefghi", "abcdefghijklmno", "abcdefghijklmnp", "abcdefgxijklmno", "abcdefghijklmnop", "abcdefghijklmnoq", "abcdefghxjklmnop",
    "abcdefghijklmnopq", "abcdefghijklmnopr", "abcdefghijklmnopqrstuvwxyz0123456789", "abcdefghijklmnopqrstuvwxyz012345678x", "abcdefghijklmnopqrstuvwxyz0x23456789", "xbcdefghijklmnopqrstuvwxyz0123456789", "caf\u00e9", "caf\u00e8", "identifier", "expression", "\u00ff\u00fe\u00fd\u00fc\u00fb\u00fa\u00f9\u00f8\u00f7"];
// Mixed on purpose: nothing can be expected of an element.
const values: any[] = [undefined, null, true, false, 0, -0, 1, 1.5, NaN, 10n, 10n ** 30n, Symbol.iterator, {}, [], "\u65e5\u672c", "\u65e5\u672d", "\u65e5"];
for (const t of texts) {
    values.push(t, fresh(t), JSON.parse(JSON.stringify(t)));
    if (t.length > 1)
        values.push(wide(t), cat(t.slice(0, 1), t.slice(1)), ("<" + t + ">").slice(1, -1), new String(t));
}
export function sameUnknown(a: any, b: any): boolean { return a === b; }
export function differsUnknown(a: any, b: any): boolean { return a !== b; }
export function isKind(o: any): string { return "" + (o.kind === "identifier") + (o.kind === "expression") + (o.kind !== "abcdefgh") + ("abcdefghijklmnopqrstuvwxyz0123456789" === o.kind) + (o.kind === "") + (o.kind === "caf\u00e9") + (o.kind === "\u65e5\u672c"); }
let line = "";
let count = 0;
for (let i = 0; i < values.length; i++) {
    let row = 0;
    for (let j = 0; j < values.length; j++) {
        const s = sameUnknown(values[i], values[j]);
        if (s === differsUnknown(values[i], values[j]) || s !== sameUnknown(values[j], values[i]))
            print("inconsistent at " + i + ", " + j);
        if (s) {
            row = (row * 31 + j + 1) % 1000003;
            count++;
        }
    }
    line += " " + row;
}
print(values.length + " values, " + count + " pairs are the same:" + line);
for (const v of values)
    line = isKind({ kind: v }) + (typeof v === "string" ? " " + show(v) : "");
for (const t of ["identifier", "expression", "abcdefgh", "abcdefghijklmnopqrstuvwxyz0123456789", "", "caf\u00e9", "\u65e5\u672c", "identifies", "Identifier", "abcdefghijklmnopqrstuvwxyz012345678x"]) {
    for (const v of [t, fresh(t), JSON.parse(JSON.stringify({ kind: t })).kind, t.length > 1 ? wide(t) : t, t.length > 1 ? cat(t.slice(0, 1), t.slice(1)) : t])
        print(show(t) + " " + isKind({ kind: v }));
}
// The functions that the expectations name must stay functions: one that is inlined into all of its callers has no code of its own.
(globalThis as any).kept = [sameUnknown, isKind]; console.log("number");
