"use strict";
function withBoolean(x, y) { return ((x * 0.5) & (y === 3)) + ((x * 0.5) | (y === 3)) + ((x * 0.5) ^ (y !== 3)) + ((x * 0.5) << (y === 3)) + ((y === 3) >>> (x * 0.5)); }
function withNull(x) { return ((x * 0.5) | null) + ((x * 0.5) ^ null) + (null >> (x * 0.5)); }
function withUndefined(x) { return ((x * 0.5) | undefined) + ((x * 0.5) & undefined) + (undefined >>> (x * 0.5)); }
function negated(x, y) { return ~(x * 0.5) + ~(y === 3); }
const numbers = JSON.parse("[0, 1, 3, 7.5, -7.5, 4294967297.5, -4294967297.5, 1e21, 1e300]");
numbers.push(NaN, Infinity, -Infinity, -0);
console.log(withBoolean(numbers[3], numbers[2]), withBoolean(numbers[5], numbers[1]), withNull(numbers[4]), withUndefined(numbers[6]), negated(numbers[7], numbers[2]), negated(numbers[9], numbers[0]));
for (const x of numbers) console.log(withBoolean(x, 3), withBoolean(x, x), withNull(x), withUndefined(x), negated(x, 3), negated(3, x));
