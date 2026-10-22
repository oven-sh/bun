// A position computed as y * w + x is a double once the product may pass 2^53. Below that it names an element, beyond it it names a property, rounded as JavaScript rounds it.
const argument: number = parseInt(process.argv[2] ?? "7", 10) | 0;
const seen: unknown[] = [];
function note(value: unknown): void { seen.push(value === undefined ? "undefined" : Object.is(value, -0) ? "-0" : value); }

const cells: number[] = [];
for (let i = 0; i < 64; ++i) cells.push(i * 3);
const bytes = new Uint8Array(64);
for (let i = 0; i < 64; ++i) bytes[i] = i + 100;
const words = "abcdefghijklmnopqrstuvwxyz";

function at(y: number, w: number, x: number): unknown { return cells[(y | 0) * (w | 0) + (x | 0)]; }
function atDifference(y: number, w: number, x: number): unknown { return cells[(y | 0) * (w | 0) - (x | 0)]; }
function atReversed(y: number, w: number, x: number): unknown { return cells[(x | 0) - (y | 0) * (w | 0)]; }
function atProduct(y: number, w: number): unknown { return cells[(y | 0) * (w | 0)]; }
function atTwoTerms(y: number, w: number, x: number, z: number): unknown { return cells[(y | 0) * (w | 0) + (x | 0) + (z | 0) + 1]; }
function atTwoProducts(a: number, b: number, c: number, d: number): unknown { return cells[(a | 0) * (b | 0) - (c | 0) * (d | 0)]; }
function byteAt(y: number, w: number, x: number): unknown { return bytes[(y | 0) * (w | 0) + (x | 0)]; }
function letterAt(y: number, w: number, x: number): unknown { return words[(y | 0) * (w | 0) + (x | 0)]; }
function put(y: number, w: number, x: number, value: number): void { cells[(y | 0) * (w | 0) + (x | 0)] = value; }
function putByte(y: number, w: number, x: number, value: number): void { bytes[(y | 0) * (w | 0) + (x | 0)] = value; }
function has(y: number, w: number, x: number): boolean { return ((y | 0) * (w | 0) + (x | 0)) in cells; }

const most = 2147483647, least = -2147483648;
for (const [y, w, x] of [[2, argument, 3], [0, argument, 0], [0, -argument, 0], [-1, argument, 10], [9, argument, 0], [9, argument, 1], [-1, 1, 0], [most, most, 0], [least, least, 0], [least, most, 5], [most, most, least], [94906267, 94906267, 0], [94906266, 94906266, 1], [65536, 65536, 0], [65536, 65535, 65535]]) {
    note(at(y, w, x)); note(atDifference(y, w, x)); note(atReversed(y, w, x)); note(atProduct(y, w)); note(atTwoTerms(y, w, x, -1)); note(byteAt(y, w, x)); note(letterAt(y, w, x)); note(has(y, w, x));
}

// 94906267 * 94906267 is 9007199515875289, which no double holds: JavaScript asks for the property "9007199515875288".
const rounded = 1001, exact = 1002;
const named = cells as unknown as Record<string, number>;
named["9007199515875288"] = rounded; named["9007199515875289"] = exact; named["4611686014132420609"] = exact; named["4611686014132420600"] = rounded; named["-1"] = 1003;
note(atProduct(94906267, 94906267)); note(at(94906267, 94906267, 0)); note(at(94906267, 94906267, 1)); note(atProduct(most, most)); note(at(-1, 1, 0)); note(has(94906267, 94906267, 0)); note(has(-1, 1, 0));
put(94906267, 94906267, 0, 5); note(named["9007199515875288"]); note(named["9007199515875289"]); note(cells.length);
// The two products are rounded apart and their difference is not the difference of the exact ones.
note(atTwoProducts(94906267, 94906267, 94906267, 94906266)); note(atTwoProducts(most, most, most, most - 1) === undefined); note(atTwoProducts(3, argument, 2, argument));
note(94906267 * 94906267 - 94906266 * 94906268);
function differenceOfProducts(a: number, b: number, c: number, d: number): unknown { return cells[(a | 0) * (b | 0) - (c | 0) * (d | 0)]; }
note(differenceOfProducts(94906267, 94906267, 94906266, 94906268));

put(2, argument, 3, -5); note(cells[2 * argument + 3]); put(9, argument, 2, 77); note(cells.length); note(cells[65]); note(cells[64]);
putByte(2, argument, 3, 300); note(bytes[2 * argument + 3]); putByte(most, most, 0, 1); putByte(-1, 1, 0, 1); note(bytes.length); note(Object.keys(bytes).length);

let total = 0;
const width = argument + 1, height = 8;
for (let y = 0; y < height; ++y)
    for (let x = 0; x < width; ++x)
        total = (total + (cells[y * width + x] as number)) | 0;
note(total);
console.log(seen.join(" | "));
