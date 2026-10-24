// (a * b) | 0 takes the low word of the ROUNDED product: beyond 2^53 that is not the low word of the exact one.
const argument: number = parseInt(process.argv[2] ?? "7", 10) | 0;
const seen: unknown[] = [];
function note(value: unknown): void { seen.push(Object.is(value, -0) ? "-0" : value); }

function product(a: number, b: number): number { return ((a | 0) * (b | 0)) | 0; }
function unsignedProduct(a: number, b: number): number { return ((a | 0) * (b | 0)) >>> 0; }
function productAndTerm(a: number, b: number, c: number): number { return ((a | 0) * (b | 0) + (c | 0)) | 0; }
function termLessProduct(a: number, b: number, c: number): number { return ((c | 0) - (a | 0) * (b | 0)) | 0; }
function maskedProduct(a: number, b: number): number { return ((a | 0) * (b | 0)) & 0x7fffffff; }
function shiftedProduct(a: number, b: number): number { return ((a | 0) * (b | 0)) >> 3; }
function invertedProduct(a: number, b: number): number { return ~((a | 0) * (b | 0)); }
function twoProducts(a: number, b: number, c: number, d: number): number { return ((a | 0) * (b | 0) + (c | 0) * (d | 0)) | 0; }
function productOfNumber(a: number, b: number): number { return ((a | 0) * b) | 0; }
function keptProduct(a: number, b: number): number { return (a | 0) * (b | 0); }
function step(seed: number): number { return ((seed | 0) * 1103515245 + 12345) & 0x7fffffff; }

const most = 2147483647, least = -2147483648;
const values = [0, 1, -1, argument, -argument, 46340, 46341, -46341, 65535, 65536, 94906267, 94906266, 1103515245, most, least, most - 1, least + 1];
for (const a of values) {
    for (const b of values) {
        note(product(a, b)); note(unsignedProduct(a, b)); note(productAndTerm(a, b, argument)); note(productAndTerm(a, b, least)); note(termLessProduct(a, b, most));
        note(maskedProduct(a, b)); note(shiftedProduct(a, b)); note(invertedProduct(a, b)); note(twoProducts(a, b, b, a)); note(productOfNumber(a, b + 0.5)); note(keptProduct(a, b));
    }
}
let seed = argument;
for (let i = 0; i < 20; ++i) { seed = step(seed); note(seed); }
let hash = 0;
for (const value of seen) hash = (Math.imul(hash, 31) + (typeof value === "number" ? (value | 0) ^ ((value / 4294967296) | 0) : 7)) | 0;
console.log(seen.length, hash, seen.slice(0, 44).join(" "), seen.slice(-24).join(" "));
