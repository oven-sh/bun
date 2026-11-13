// The first array that Array.from() makes at a site takes the kind of its elements, as the later ones do.
import { describe } from "bun:jsc";
const kindOf = array => describe(array).match(/ArrayWith\w+/)?.[0];
const rows = (m, n, f) => Array.from({ length: m }, (_, i) => Array.from({ length: n }, (_, j) => f(i, j)));
const other = (m, n, f) => Array.from({ length: m }, (_, i) => Array.from({ length: n }, (_, j) => f(i, j)));
const third = (m, n, f) => Array.from({ length: m }, (_, i) => Array.from({ length: n }, (_, j) => f(i, j)));
globalThis["kinds" + process.pid] = [rows, other, third];
console.log(...rows(3, 4, (i, j) => Math.sin(i + j + 1)).map(kindOf));
console.log(...other(3, 4, (i, j) => "t" + i + j).map(kindOf));
console.log(...third(3, 4, (i, j) => (j < 2 ? i : { i })).map(kindOf));
