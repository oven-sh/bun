// The same as untyped-value-vs-many-integers.js in typed text: the value is `any`, `unknown` or a union of a number with other things.
// SIZE< classify 330
// SIZE< isOneOf 150
function classify(kind: any): string {
  switch (kind) {
    case 80: return "a";
    case 81: return "b";
    case 95: return "c";
    case 110: return "d";
    case 111: return "e";
    case 200: return "f";
    case 201: return "g";
    case 300: return "h";
    default: return "z";
  }
}
function isOneOf(x: unknown): boolean { return x === 83 || x === 84 || x === 90 || x === 101 || x === 120; }
function ofUnion(x: number | string | null | { n: number }): string { return x === 1 ? "1" : x === 80 ? "80" : x === "80" ? "text" : x === 0 ? "0" : x === null ? "null" : x === 300 ? "300" : "none"; }
function ofOptional(x?: number | bigint): number { return x === 80 ? 1 : x === 81 ? 2 : x === 0 ? 3 : x === undefined ? 4 : 0; }
function ofProperty(o: { kind: any }): number { return o.kind === 80 ? 1 : o.kind === 81 ? 2 : o.kind === 300 ? 3 : 0; }
const doubles = new Float64Array([80, -0, NaN, 81, 300, 0, 83]);
const values: any[] = [80, 81, 95, 110, 111, 200, 201, 300, 83, 84, 90, 101, 120, 1, 0, -0, 0.5, 80.5, NaN, Infinity, 2147483648, 4294967376, 1e300, "80", "", null, undefined, true, false, 80n, { valueOf() { return 80; } }, [80], new Number(80),
  doubles[0], doubles[1], doubles[2], doubles[3], doubles[4], doubles[5], doubles[6], 160 / 2, Math.sqrt(6400), Number("81"), JSON.parse("8e1")];
console.log(values.map(classify).join(""));
console.log(values.map(isOneOf).join(" "));
console.log(values.map((x) => ofProperty({ kind: x })).join(""));
const union: (number | string | null | { n: number })[] = [1, 80, "80", 0, -0, null, 300, 80.5, NaN, { n: 80 }, doubles[0], doubles[1], doubles[4], ""];
console.log(union.map(ofUnion).join(" "));
const optional: (number | bigint | undefined)[] = [80, 81, 0, -0, undefined, 80n, 0n, 80.5, NaN, doubles[0], doubles[3], doubles[1]];
console.log(optional.map((x) => ofOptional(x)).join(""), ofOptional());
