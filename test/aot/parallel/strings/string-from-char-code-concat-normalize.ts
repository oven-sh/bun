// `String(x)`, `String.fromCharCode`, `String.fromCodePoint`, `concat`, `normalize`, `isWellFormed` and `toWellFormed`.
// CALLS- stringOfString CallHostFunction|CallValue
// CALLS- stringOfNumber CallHostFunction|CallValue
// CALLS- stringOfInteger CallHostFunction|CallValue
// CALLS- stringOfBoolean CallHostFunction|CallValue
// CALLS- fromCharCodeMasked CallHostFunction|CallValue|CharToString|FromC
// CALLS+ fromCharCode1 CharToString
// CALLS- fromCharCodeInteger CallHostFunction|CallValue
// CALLS- fromCharCodeByte CallHostFunction|CallValue|CharToString|FromC
// CALLS- concatKnown CallHostFunction|CallValue
// CALLS+ concatKnown operationAOTConcat
// CALLS- stringOfAnything CallHostFunction|CallValue
// CALLS+ stringOfAnything operationAOTStringOfAnyValue
// CALLS+ fromCharCode3 CallHostFunction
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
export function stringOfString(x: string): string { return String(x); }
export function stringOfNumber(x: number): string { return String(x); }
export function stringOfInteger(x: number): string { return String(x | 0) + String(x & 255) + String((x | 0) * 4096); }
export function stringOfBoolean(x: boolean): string { return String(x); }
export function stringOfBigInt(x: bigint): string { return String(x); }
export function stringOfOptional(x: number | undefined): string { return String(x); }
export function stringOfUnion(x: string | number | boolean | null | undefined): string { return String(x); }
export function stringOfAnything(x: unknown): string { return String(x); }
export function fromCharCode1(x: number): string { return String.fromCharCode(x); }
export function fromCharCodeMasked(x: number): string { return String.fromCharCode(65 + (x & 15)); }
export function fromCharCodeByte(x: number): string { return String.fromCharCode(x & 255); }
export function fromCharCodeInteger(x: number): string { return String.fromCharCode(x | 0) + String.fromCharCode((x | 0) * 65536 + 65) + String.fromCharCode(x & 0xffff); }
export function fromCharCode3(x: number): string { return String.fromCharCode(x, x + 1, x + 2); }
export function fromCharCodeOfAnything(x: any): unknown { return String.fromCharCode(x); }
export function fromCodePoint1(x: number): string { return String.fromCodePoint(x); }
export function fromCodePointMasked(x: number): string { return String.fromCodePoint(65 + (x & 15)); }
export function fromCodePointByte(x: number): string { return String.fromCodePoint(x & 255); }
export function fromCodePointInteger(x: number): string { return String.fromCodePoint(x | 0); }
export function fromCodePointOfAnything(x: any): unknown { return String.fromCodePoint(x); }
export function concat1(s: string, a: string): string { return s.concat(a); }
export function concat2(s: string, a: string, b: string): string { return s.concat(a, b); }
export function concat3(s: string, a: string, b: string, c: string): string { return s.concat(a, b, c); }
export function concatKnown(s: string, a: string, b: string): string { const x = `${s}`, y = `${a}`, z = `${b}`; return x.concat(y).concat(z, y); }
export function concatNumber(s: string, a: number): string { return s.concat(a as any); }
export function concatOfAnything(s: any, a: any, b: any): unknown { return s.concat(a, b); }
export function normalize0(s: string): string { return s.normalize(); }
export function normalize1(s: string, form: string): string { return s.normalize(form); }
export function isWellFormed_(s: string): boolean { return s.isWellFormed(); }
export function toWellFormed_(s: string): string { return s.toWellFormed(); }
export function formsOfAnything(s: any): string { return show(s.normalize()) + show(s.isWellFormed()) + show(s.toWellFormed()); }
const numbers = [0, -0, 1, -1, 9, 10, 42, 255, 256, 1023, 1024, 65535, 65536, 65601, 1114111, 1114112, 2147483647, 2147483648, -2147483648, -2147483649, 4294967295, 4294967296, 4294967361, 9007199254740991, 9007199254740992, 1e21, -1e21, 1e-7, 0.1, 0.5, 1.5, -1.5, 65.9, -65.9, 123456.789, 1.7976931348623157e308, 5e-324, NaN, Infinity, -Infinity];
let line = "";
for (const x of numbers)
    line += " " + stringOfNumber(x) + "|" + stringOfInteger(x) + "|" + stringOfOptional(x) + "|" + stringOfUnion(x) + "|" + stringOfAnything(x);
print(line);
line = "";
for (const x of numbers)
    line += " " + show(fromCharCode1(x)) + show(fromCharCodeMasked(x)) + show(fromCharCodeByte(x)) + show(fromCharCodeInteger(x)) + show(fromCharCode3(x)) + show(fromCharCodeOfAnything(x));
print(line);
line = "";
for (const x of numbers)
    line += " " + attempt(() => fromCodePoint1(x)) + show(fromCodePointMasked(x)) + show(fromCodePointByte(x)) + attempt(() => fromCodePointInteger(x)) + attempt(() => fromCodePointOfAnything(x));
print(line);
for (let i = 0; i < 300; i += 37)
    print(show(fromCharCodeMasked(i)) + show(fromCodePointMasked(i)) + show(fromCharCodeByte(i)) + show(fromCodePointByte(i)) + show(stringOfInteger(i)));
print(show(stringOfString("text")) + show(stringOfString("")) + show(stringOfString(cat("ro", "pe"))) + show(stringOfString(undefined as unknown as string)) + show(stringOfString(null as unknown as string)) + show(stringOfString("\u65e5\ud800")));
print(stringOfBoolean(true) + stringOfBoolean(false) + stringOfBigInt(0n) + stringOfBigInt(-12345678901234567890123n) + stringOfOptional(undefined) + stringOfUnion(null) + stringOfUnion(undefined) + stringOfUnion(true) + stringOfUnion("s") + String() + show(String("")));
let order = "";
for (const x of [undefined, null, true, "s", 12n, Symbol("described"), Symbol(), Symbol.iterator, {}, [], [1, [2, 3]], { toString() { order += "t"; return "by toString"; } }, { valueOf() { order += "v"; return "by valueOf"; }, toString: undefined }, { [Symbol.toPrimitive](hint: string) { order += hint; return 7; } },
    { toString() { return {}; }, valueOf() { return {}; } }, { toString() { throw new RangeError("thrown"); } }, new String("boxed"), new Number(5), /re/g, new Date(0).getTime(), Object.create(null)])
    print(attempt(() => stringOfAnything(x)) + " " + attempt(() => fromCharCodeOfAnything(x)) + " " + attempt(() => fromCodePointOfAnything(x)) + " " + attempt(() => concatOfAnything("<", x, ">")));
print(order);
print(show(String.fromCharCode()) + show(String.fromCodePoint()) + show(String.fromCharCode(0x41, 0x10042, -1)) + show(String.fromCodePoint(0x41, 0x1f600, 0x10ffff)) + attempt(() => String.fromCodePoint(0x41, -1)) + attempt(() => String.fromCodePoint(1.5)) + attempt(() => (String.fromCodePoint as any)("65")) + attempt(() => (String.fromCharCode as any)("65", "x", null)));
const strings = [() => "", () => "a", () => "text", () => "caf\u00e9", () => "\u65e5\u672c", () => cat("ro", "pe"), () => cat("r\u00e9", "\u65e5"), () => part("xxpartxx", 2, 6), () => "e\u0301", () => "\u00c5\u212b\u0041\u030a", () => "\ufb01\u1e9b\u0323", () => "\ud83d\ude00", () => "a\ud83d", () => "\ude00a", () => cat("\ud83d", "\ude00"), () => cat("a\ud83d", "b")];
for (const s of strings) {
    line = show(normalize0(s())) + show(isWellFormed_(s())) + show(toWellFormed_(s())) + formsOfAnything(s());
    for (const form of ["NFC", "NFD", "NFKC", "NFKD"])
        line += show(normalize1(s(), form));
    for (const other of strings)
        line += " " + show(concat1(s(), other())).length + show(concat2(s(), other(), s())).length + show(concat3(s(), other(), "-", other())).length;
    print(line + show(concatKnown(s(), "-", s())) + show(concat1(s(), "!")) + show(concat2("<", s(), ">")) + show(concatNumber(s(), 1.5)) + show((s() as any).concat()) + show(concat1(s(), undefined as unknown as string)));
}
print(attempt(() => normalize1("a", "nfc")) + attempt(() => normalize1("a", "")) + attempt(() => normalize1("a", undefined as unknown as string)) + attempt(() => normalize1("a", null as unknown as string)) + attempt(() => ("\u65e5" as any).normalize({ toString() { return "NFD"; } })));
for (const nil of [undefined, null]) {
    const s = nil as unknown as string;
    print(attempt(() => concat1(s, "a")) + attempt(() => normalize0(s)) + attempt(() => isWellFormed_(s)) + attempt(() => toWellFormed_(s)) + attempt(() => formsOfAnything(nil)) + attempt(() => concatOfAnything(nil, 1, 2)));
}
for (const other of [new String("boxed"), { normalize() { return 1; }, isWellFormed() { return 2; }, toWellFormed() { return 3; } }, 12])
    print(attempt(() => formsOfAnything(other)) + attempt(() => concatOfAnything(other, 1, 2)));
const big = "x".repeat(1 << 30);
print(attempt(() => concat1(big, big).length) + attempt(() => concat2(big, big, big).length) + attempt(() => concat1(big, "").length));
// The functions the expectations name stay functions: one that is copied into all its callers has no code of its own.
(globalThis as any).kept = [stringOfString, stringOfNumber, stringOfInteger, stringOfBoolean, fromCharCodeMasked, fromCharCode1, fromCodePointMasked, fromCharCodeByte, fromCodePointByte, concatKnown, stringOfAnything, fromCharCode3]; console.log("number");
