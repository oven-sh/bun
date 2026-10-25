// A built-in's optional trailing argument that is given, or that may be undefined, keeps the built-in off the host call: slice, substring and substr with an end of number | undefined; Array.slice likewise; Array.indexOf and includes with a start.
// CALLS- sliceToMaybe CallHostFunction
// CALLS- substringToMaybe CallHostFunction
// CALLS- substrOfMaybe CallHostFunction
// CALLS- sliceFromMaybe CallHostFunction
// CALLS- substringFromMaybe CallHostFunction
// CALLS- substrFromMaybe CallHostFunction
// CALLS- sliceBetweenMaybes CallHostFunction
// CALLS+ sliceFromNullable CallHostFunction
// CALLS- arraySliceToMaybe CallHostFunction
// CALLS+ sliceToNullable CallBoxedBuiltin\.StringSlice
// CALLS+ arrayIndexOfFrom ArraySearch\.IndexOfFrom
// CALLS+ arrayIncludesFrom ArraySearch\.IncludesFrom
// CALLS+ arrayIndexOfFromMaybe ArraySearch\.IndexOfFrom
export function sliceToMaybe(s: string, a: number, b: number | undefined): string { return s.slice(a, b); }
export function sliceOfInteger(s: string, a: number, b: number): string { return s.slice(a, b === -1 ? undefined : b); }
export function substringToMaybe(s: string, a: number, b: number | undefined): string { return s.substring(a, b); }
export function substrOfMaybe(s: string, a: number, b: number | undefined): string { return s.substr(a, b); }
export function sliceToNullable(s: string, a: number, b: number | null | undefined): string { return s.slice(a, b as number); }
export function sliceFromMaybe(s: string, a?: number): string { return s.slice(a); }
export function substringFromMaybe(s: string, a: number | undefined): string { return s.substring(a as number); }
export function substrFromMaybe(s: string, a: number | undefined): string { return s.substr(a as number); }
export function sliceBetweenMaybes(s: string, a: number | undefined, b: number | undefined): string { return s.slice(a, b); }
export function sliceFromNullable(s: string, a: number | null | undefined): string { return s.slice(a as number); }
export function arraySliceToMaybe(list: string[], a: number, b: number | undefined): string[] { return list.slice(a, b); }
export function arrayIndexOfFrom(list: string[], x: string, from: number): number { return list.indexOf(x, from); }
export function arrayIncludesFrom(list: string[], x: string, from: number): boolean { return list.includes(x, from); }
export function arrayIndexOfFromMaybe(list: string[], x: string, from: number | undefined): number { return list.indexOf(x, from); }
export function arrayIncludesFromMaybe(list: string[], x: string, from: number | undefined): boolean { return list.includes(x, from); }
export function numberIndexOfFrom(list: number[], x: number, from: number): number { return list.indexOf(x, from); }
export function numberIncludesFrom(list: number[], x: number, from: number): boolean { return list.includes(x, from); }
export function anyIndexOfFrom(list: unknown[], x: unknown, from: number): number { return list.indexOf(x, from); }
export function anyIncludesFrom(list: unknown[], x: unknown, from: number): boolean { return list.includes(x, from); }
const positions: (number | undefined)[] = [undefined, 0, 1, 2, 5, 7, 8, 100, -1, -2, -7, -8, -100, 1.5, -1.5, 2.9, NaN, Infinity, -Infinity, 4294967296, -4294967296, 2147483648, 1e300, -1e300, -0];
const text = "abcdefgh";
const wide = "abሴdefgh";
for (const s of [text, wide, ""]) {
  for (const a of [0, 2, -3, 9, 1.5, NaN]) {
    const row: string[] = [];
    for (const b of positions) row.push(sliceToMaybe(s, a, b), substringToMaybe(s, a, b), substrOfMaybe(s, a, b));
    console.log(JSON.stringify(row));
  }
}
console.log(sliceOfInteger(text, 2, -1), sliceOfInteger(text, 2, 4), sliceToNullable(text, 2, null) === "", sliceToNullable(text, 2, undefined));
for (const s of [text, wide, ""]) {
  const row: string[] = [sliceFromMaybe(s)];
  for (const a of positions) {
    row.push(sliceFromMaybe(s, a), substringFromMaybe(s, a), substrFromMaybe(s, a), sliceFromNullable(s, a));
    for (const b of [undefined, 0, 3, -2, 100, NaN]) row.push(sliceBetweenMaybes(s, a, b));
  }
  console.log(JSON.stringify(row));
}
console.log(sliceFromNullable(text, null), sliceFromNullable(text, 3));
const strings = ["", "alpha", "beta", "alpha", "al" + "pha", "gamma", "beta"];
const rope = ["x".repeat(20) + strings[1], "y"];
const long: string[] = [];
for (let i = 0; i < 200; i++) long.push("item" + (i % 50));
const found: unknown[] = [];
for (const from of positions) {
  found.push(arraySliceToMaybe(strings, 1, from).length, arraySliceToMaybe(strings, -3, from).join());
  for (const x of ["alpha", "beta", "", "none", "al" + "pha".slice(0, 3)]) {
    found.push(arrayIndexOfFromMaybe(strings, x, from), arrayIncludesFromMaybe(strings, x, from));
    if (from !== undefined) found.push(arrayIndexOfFrom(strings, x, from), arrayIncludesFrom(strings, x, from));
  }
  found.push(arrayIndexOfFromMaybe(rope, "x".repeat(20) + "alpha", from), arrayIndexOfFromMaybe(long, "item49", from), arrayIncludesFromMaybe(long, "item7", from));
  if (from !== undefined) {
    found.push(numberIndexOfFrom([1, 2, 3, 2, 1], 2, from), numberIncludesFrom([1, 2, 3, 2, 1], 1, from), numberIndexOfFrom([1.5, 2.5, NaN, 2.5], 2.5, from), numberIncludesFrom([1.5, NaN], NaN, from), numberIndexOfFrom([1.5, NaN], NaN, from));
    const sparse: unknown[] = [1, , undefined, null, 1];
    found.push(anyIndexOfFrom(sparse, undefined, from), anyIncludesFrom(sparse, undefined, from), anyIndexOfFrom(sparse, null, from), anyIncludesFrom(sparse, null, from), anyIndexOfFrom(sparse, 1, from), anyIndexOfFrom(sparse, 1n, from));
    const o = {}; const objects: unknown[] = [o, "s", 2, o, true, Symbol.iterator];
    found.push(anyIndexOfFrom(objects, o, from), anyIncludesFrom(objects, true, from), anyIndexOfFrom(objects, Symbol.iterator, from), anyIndexOfFrom(objects, 2, from), anyIndexOfFrom(objects, 2.0, from), anyIncludesFrom(objects, "s", from));
  }
}
console.log(JSON.stringify(found.map(v => typeof v === "boolean" ? (v ? 1 : 0) : v)));
class Mine extends Array<string> { override indexOf(x: string, from?: number): number { return 100 + super.indexOf(x, from); } }
const mine = new Mine(); mine.push("a", "b", "a");
const asPlain: string[] = mine;
console.log(arrayIndexOfFrom(asPlain, "a", 1), arrayIncludesFrom(asPlain, "a", 1), arraySliceToMaybe(asPlain, 1, undefined).length);
const frozen = Object.freeze(["a", "b", "a"]) as string[];
console.log(arrayIndexOfFrom(frozen, "a", 1), arrayIncludesFrom(frozen, "b", 2));
const changing = ["a", "b", "c"];
console.log(arrayIndexOfFrom(changing, "c", 3), arrayIndexOfFrom(changing, "c", 2), (changing.length = 1, arrayIndexOfFrom(changing, "c", 2)), arrayIncludesFrom([], "c", 0), arrayIndexOfFrom([], "c", -1));
