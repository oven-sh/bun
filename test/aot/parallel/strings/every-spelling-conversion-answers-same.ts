// `+text` and `Number(text)`, `String(value)` and a template: the spellings of one conversion answer the same, whatever the text or the value.
const texts: string[] = ["", " ", "0", "-0", "12", " 12 ", "1e3", "1e400", "-1e400", ".5", "5.", "0x1f", "0b101", "0o17", "0x", "1_000", "Infinity", "-Infinity", "+Infinity", "infinity", "NaN",
  "12px", "1 2", "\n7\t", " 7﻿", "9007199254740993", "0.1", "1e-7", "123456789012345678901234567890", "١", "١٢", "+", "-", "+-1", "1n", "٣", "😀", "1\u0000"];
const ropes: string[] = texts.map((text, index) => text + (index & 1 ? "" : "") + "1".repeat(index % 3));
const wide: string[] = texts.map(text => (text + "一").slice(0, -1));

function plus(text: string): number { return +text; }
function called(text: string): number { return Number(text); }
function minusZero(text: string): number { return text as any - 0; }
function timesOne(text: string): number { return (text as any) * 1; }
function ofASlice(text: string): number { return +text.slice(1); }
function ofASum(a: string, b: string): number { return +(a + b); }
function ofEither(value: string | number): number { return +value; }
function ofMaybe(value: string | undefined): number { return +(value as any); }
function show(n: number): string { return Object.is(n, -0) ? "-0" : String(n); }

for (const list of [texts, ropes, wide]) {
  console.log(list.map(text => show(plus(text))).join());
  console.log(list.every(text => Object.is(plus(text), called(text)) && Object.is(plus(text), timesOne(text)) && Object.is(minusZero(text), called(text) - 0)));
  console.log(list.map(text => show(ofASlice(text))).join());
  console.log(list.map((text, index) => show(ofASum(text, list[(index + 1) % list.length]))).join());
  console.log(list.map((text, index) => show(ofEither(index & 1 ? text : index)) + show(ofMaybe(index & 2 ? text : undefined))).join());
}

const numbers: number[] = [0, -0, 1, -1, 7, 255, 256, 1023, 65536, 2147483647, -2147483648, 2147483648, 4294967296, 9007199254740991, 9007199254740992, 1e21, 1e-7, 0.1, 1.5, -1.5, NaN, Infinity, -Infinity, 123456789.125];
function stringOfNumber(n: number): string { return String(n); }
function templateOfNumber(n: number): string { return `${n}`; }
function stringOfInteger(n: number): string { return String(n | 0); }
function stringOfUnsigned(n: number): string { return String(n >>> 0); }
function stringOfText(s: string): string { return String(s); }
function stringOfBoolean(b: boolean): string { return String(b); }
function stringOfBigInt(b: bigint): string { return String(b); }
function stringOfMaybeNumber(n: number | undefined): string { return String(n); }
function stringOfMaybeText(s: string | null): string { return String(s); }
function stringOfTextOrNumber(v: string | number): string { return String(v); }
function stringOfPrimitive(v: string | number | boolean | bigint | null | undefined): string { return String(v); }
function stringOfAnything(v: unknown): string { return String(v); }
function stringOfNothing(): string { return String(); }

console.log(numbers.map(stringOfNumber).join(), numbers.every(n => stringOfNumber(n) === templateOfNumber(n) && stringOfNumber(n) === "" + n && stringOfNumber(n) === n.toString()));
console.log(numbers.map(stringOfInteger).join(), numbers.map(stringOfUnsigned).join());
console.log(texts.every(text => stringOfText(text) === text), ropes.every(text => stringOfText(text) === text), stringOfBoolean(true), stringOfBoolean(false), stringOfBigInt(-12345678901234567890n), JSON.stringify(stringOfNothing()));
console.log(numbers.map((n, index) => stringOfMaybeNumber(index & 1 ? n : undefined)).join(), texts.slice(0, 6).map((text, index) => stringOfMaybeText(index & 1 ? text : null)).join("|"));
console.log(numbers.map((n, index) => stringOfTextOrNumber(index & 1 ? n : "t" + index)).join());
console.log([1, "a", true, 2n, null, undefined, 1.5, -0].map(stringOfPrimitive).join());
console.log([1, "a", Symbol("s"), Symbol(), { toString() { return "mine"; } }, [1, [2, 3]], null, undefined, () => 1, new Date(0).getTime(), { valueOf() { return 1; } }].map(stringOfAnything).join("|"));
try { console.log(`${Symbol("s") as any}`); } catch (error) { console.log((error as Error).constructor.name); }
try { console.log(+(Symbol("s") as any)); } catch (error) { console.log((error as Error).constructor.name); }
try { console.log(+(1n as any)); } catch (error) { console.log((error as Error).constructor.name, Number(1n)); }
