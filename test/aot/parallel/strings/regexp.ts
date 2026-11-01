// RegExp literals, and the string methods that take a RegExp or a string.
// CALLS+ literal NewRegExpLiteral
// CALLS- literal ConstructInternalFunction
// CALLS+ constants NewRegExpLiteral
// CALLS+ fromSources operationAOTNewRegExp
// CALLS+ fromBoth ConstructInternalFunction2
// CALLS+ vowels StringReplaceRegExpString
// CALLS+ shout operationAOTStringReplaceRegExp
// CALLS+ swap operationAOTStringReplaceString
// CALLS+ words operationAOTStringSplitRegExp
// CALLS+ parts operationAOTStringSplitString
// CALLS+ found (?<!Typed)StringMatchRegExp
// CALLS+ where operationAOTStringSearchRegExp
// CALLS- isGlobal CallHostFunction
// CALLS+ flagsOf operationAOTRegExpFlags
// CALLS+ sourceOf operationAOTRegExpSource
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
export function literal(): RegExp { return /a+(b)?/gi; }
export function constants(): RegExp { return new RegExp("a+(b)?", "gi"); }
export function fromSource(s: string): RegExp { return new RegExp(s, "g"); }
export function fromSources(list: string[]): RegExp[] { const out: RegExp[] = []; for (const s of list) out.push(new RegExp(s, "g")); return out; }
export function fromBoth(s: string, f: string): RegExp { return new RegExp(s, f); }
export function vowels(s: string, re: RegExp, by: string): string { return s.replace(re, by); }
// What is of another kind than a parameter's type says is refused where it is handed over: such values go in by parameters that take anything.
function replaced(s: string, re: any, by: any): string { return s.replace(re, by); }
function cut(s: string, by: any): string[] { return s.split(by); }
function matched(s: string, by: any): RegExpMatchArray | null { return s.match(by); }
function searched(s: string, by: any): number { return s.search(by); }
export function shout(s: string, re: RegExp, f: (m: string, ...rest: any[]) => string): string { return s.replace(re, f); }
export function swap(s: string, a: string, b: string): string { return s.replace(a, b); }
export function words(s: string, re: RegExp): string[] { return s.split(re); }
export function parts(s: string, by: string): string[] { return s.split(by); }
export function found(s: string, re: RegExp): RegExpMatchArray | null { return s.match(re); }
export function where(s: string, re: RegExp): number { return s.search(re); }
export function isGlobal(re: RegExp): boolean { return re.global; }
export function flagsOf(re: RegExp): string { return re.flags; }
export function sourceOf(re: RegExp): string { return re.source; }
const list = (a: any) => a === null ? "null" : "[" + Array.from(a as any[], x => x === undefined ? "undefined" : show(x)).join() + "]" + ("index" in a ? "@" + a.index + (a.groups ? JSON.stringify(a.groups) : "") : "");
const about = (re: RegExp) => String(re) + " " + re.lastIndex + " " + [re.dotAll, re.global, re.hasIndices, re.ignoreCase, re.multiline, re.sticky, re.unicode, re.unicodeSets].map(b => b ? 1 : 0).join("") + " " + flagsOf(re) + " " + show(sourceOf(re)) + " " + isGlobal(re);
// A literal is a new object at every evaluation, with lastIndex 0.
{ const a = literal(), b = literal(); a.lastIndex = 3; (a as any).mine = 1; print([a === b, b.lastIndex, (b as any).mine, about(a), about(b), about(constants()), Object.getPrototypeOf(a) === RegExp.prototype, a instanceof RegExp, Object.getOwnPropertyNames(a).join()].map(show as any).join()); }
function sticky(s: string): string { const re = /a/y; const first = re.test(s); return first + ":" + re.lastIndex + ":" + re.test(s) + ":" + re.lastIndex; }
function counting(s: string): number { let n = 0; for (let i = 0; i < 3; i++) { const re = /a/g; while (re.exec(s)) n++; } return n; }
print(sticky("aab") + " " + sticky("ba") + " " + counting("banana"));
print([/(?:)/, /\//, /[/]/, /\n/, /\u{1f600}/u, /[\p{L}--[a-z]]/v, /(?<year>\d{4})-(?<month>\d\d)/d, /\u65e5\u672c|\u00e9/, /^$/m, /./s, / /, /a|b|c/i].map(about).join(" | "));
print([new RegExp("/"), new RegExp("\n"), new RegExp(""), new RegExp("a", ""), new RegExp("\\d+", "y"), RegExp("x", "gimsuy"), RegExp("x"), new RegExp("\u65e5", "u"), fromSource("a.c"), fromSource(cat("a", "+")), fromSource(""), fromBoth("a", "gi"), fromBoth("a", "")].map(about).join(" | "));
print([() => new RegExp("(", "g"), () => new RegExp("a", "gg"), () => new RegExp("a", "x"), () => new RegExp("a", "uv"), () => new RegExp("\\", ""), () => RegExp("[", ""), () => fromSource("("), () => fromSource("a{2,1}"), () => fromBoth("a", "q"), () => fromBoth("(?<a>.)(?<a>.)", ""), () => new RegExp("\\p{Foo}", "u")].map(f => attempt(() => about(f()))).join(" | "));
for (let round = 0; round < 3; round++) print(attempt(() => about(new RegExp("(", "g"))) + " " + about(/ok/g));
const subjects = ["", "a", "education", "The quick  brown\tfox\njumps", "aaa", "a-b_c d", "2026-10-08 and 1999-12-31", "\u65e5\u672c\u8a9e caf\u00e9", cat("ro", "pe and rope"), part("xx substring of a longer one xx", 3, 20), "$1 $& $$", "x".repeat(50) + "y"];
const expressions = [() => /[aeiou]/, () => /[aeiou]/g, () => /\s+/, () => /\s+/g, () => /(\w)(\w)?/g, () => /(?<year>\d{4})-(?<month>\d\d)/, () => /(?<year>\d{4})-(?<month>\d\d)/g, () => /a/y, () => /a/gy, () => /(?:)/, () => /(?:)/g, () => /^/gm, () => /$/, () => /\u672c|\u00e9/g, () => /./gu, () => /(a)|(b)/g, () => /x*y/, () => /nomatch/g, () => /(\d+)/d];
for (const s of subjects)
    for (const make of expressions) {
        const used = make();
        print(show(s) + " " + String(used) + ": " + [vowels(s, make(), "_"), vowels(s, make(), ""), vowels(s, make(), "[$&|$1|$2|$`|$'|$$|$<year>|$0|$3]"), shout(s, make(), (m, ...rest) => "<" + m.toUpperCase() + rest.length + ">"), list(words(s, make())), list(s.split(make(), 2)), list(s.split(make(), 0)), list(found(s, make())), where(s, make())].map(show as any).join(" ") + " " + (vowels(s, used, "_"), used.lastIndex) + (found(s, used), used.lastIndex) + (where(s, used), used.lastIndex) + (words(s, used), used.lastIndex));
    }
for (const s of subjects)
    for (const a of ["", "a", " ", "o", "ro", "$", "\u672c", "xx", "nomatch", s])
        print(show(s) + " " + show(a) + ": " + [swap(s, a, "_"), swap(s, a, ""), swap(s, a, "[$&|$`|$'|$$|$1]"), swap(s, a, cat("r", "ope")), list(parts(s, a)), list(s.split(a, 2)), list(s.split(a, 0)), list(s.split(a, 4294967295)), s.replaceAll(a, "+")].map(show as any).join(" "));
// lastIndex and what is not the plain case.
{ const re = /a/g; re.lastIndex = 2; print([vowels("aaaa", re, "b"), re.lastIndex].join()); re.lastIndex = 2; print([list(found("aaaa", re)), re.lastIndex].join()); re.lastIndex = 2; print([where("baaa", re), re.lastIndex].join()); const y = /a/y; y.lastIndex = 1; print([vowels("aaaa", y, "b"), y.lastIndex, list(found("baaa", y)), y.lastIndex, where("baaa", y), y.lastIndex].join()); }
{ const frozen = Object.freeze(/a/g); print([() => vowels("aaa", frozen, "b"), () => list(found("aaa", frozen)), () => where("baa", frozen), () => list(words("bab", frozen))].map(attempt).join(" ")); }
{ const odd = /a/g; (odd as any).lastIndex = { valueOf() { print("valueOf of lastIndex"); return 1; } }; print([() => vowels("aaa", odd, "b"), () => list(found("aaa", odd))].map(attempt).join(" ")); }
{ const own = /a/g; (own as any).exec = function () { print("own exec"); return null; }; print([() => vowels("aaa", own, "b"), () => list(found("aaa", own)), () => where("aaa", own), () => list(words("bab", own)), () => own.test("a")].map(attempt).join(" ")); }
{ const own = /a/g; Object.defineProperty(own, Symbol.replace, { value: () => "own replace" }); Object.defineProperty(own, Symbol.split, { value: () => ["own split"] }); Object.defineProperty(own, Symbol.match, { value: () => ["own match"] }); Object.defineProperty(own, Symbol.search, { value: () => -7 }); print([vowels("aaa", own, "b"), list(words("aaa", own)), list(found("aaa", own)), where("aaa", own)].join(" ")); }
{ const own = /a/g; Object.defineProperty(own, "flags", { value: "" }); Object.defineProperty(own, "global", { value: false }); print([vowels("aaa", own, "b"), flagsOf(own), isGlobal(own), list(found("aaa", own))].join(" ")); }
{ const own = /a/; Object.defineProperty(own, "flags", { value: "g" }); Object.defineProperty(own, "global", { value: true }); print([flagsOf(own), isGlobal(own)].join(" ")); }
class Sub extends RegExp { exec(s: string) { const m = super.exec(s); if (m) m[0] = m[0].toUpperCase(); return m; } get global() { return false; } }
{ const sub = new Sub("a", "g"); print([vowels("aaa", sub, "[$&]"), list(found("aaa", sub)), where("baa", sub), list(words("bab", sub)), isGlobal(sub), flagsOf(sub), sourceOf(sub)].join(" ")); }
{ const re = /a/g; re.compile("b", "i"); print(about(re) + " " + vowels("abAB", re, "_")); }
print([() => shout("abc", /b/, () => { throw new RangeError("mine"); }), () => shout("abc", /b/g, (() => 5) as any), () => shout("abc", /b/, (() => ({ toString() { return "obj"; } })) as any), () => replaced("abc", /b/, 5), () => vowels("abc", /b/, undefined as any), () => replaced("abc", /b/, { toString() { return "[$&]"; } }), () => vowels("abc", null as any, "x"), () => vowels("a null b", null as any, "x"), () => list(cut("a1b", 1)), () => list(matched("a1b", "1")), () => searched("a1b", "1"), () => list(found("abc", undefined as any)), () => list(words("abc", undefined as any))].map(attempt).join(" | "));
print([RegExp.$1, RegExp.lastMatch, (RegExp as any)["$`"]].map(show).join() + " " + (vowels("xaby", /a(b)/, "_"), [RegExp.$1, RegExp.lastMatch, (RegExp as any)["$`"]].map(show).join()) + " " + (found("xcdy", /c(d)/), [RegExp.$1, RegExp.lastMatch].map(show).join()) + " " + (where("xefy", /e(f)/), [RegExp.$1, RegExp.lastMatch].map(show).join()) + " " + (words("xghy", /g(h)/), [RegExp.$1, RegExp.lastMatch].map(show).join()));
let sum = 0; for (let i = 0; i < 20000; i++) { const s = "item " + i + ", value " + (i * 7); sum = (sum + s.replace(/\d+/g, "#").length + s.split(/,\s*/).length + (/value (\d+)/.exec(s)![1]!.length) + (/9/.test(s) ? 1 : 0) + s.search(/v/) + s.match(/\d/g)!.length) % 1000003; } print(String(sum));
// The functions the expectations name stay functions: one that is copied into all its callers has no code of its own.
print(fromSources(["a.c", "\\d+", ""]).join());
(globalThis as any).kept = [literal, constants, fromSource, fromSources, fromBoth, vowels, shout, swap, words, parts, found, where, isGlobal, flagsOf, sourceOf]; console.log("number");
