'use strict';
const given = JSON.parse('[true,false,null,null]'), numbers = JSON.parse('[2147483647,-2147483648,2147483646.5,-2147483647,4294967295,9007199254740991,1e308,-1e308,0.1,1.5,0.5,2,7]');
const names = JSON.parse('["plus","minus","times","over","rest"]');
const T = { plus(x, y) { return x + y; }, minus(x, y) { return x - y; }, times(x, y) { return x * y; }, over(x, y) { return x / y; }, rest(x, y) { return x % y; } };
const list = [10, 11, 12, 13, 14, 15, 16, 17, 18], map = new Map([[0, 'zero'], [1, 'one'], [2, 'two'], [3, 'three'], [8, 'eight'], [2147483648, 'border']]);
function pick(value) { switch (value) { case 0: return 'a'; case 1: return 'b'; case 2: return 'c'; case 3: return 'd'; case 8: return 'e'; case 2147483648: return 'f'; } return 'none'; }
const n = Number(process.argv[2] ?? 2), out = [];
for (let t = 0; t < n; t++) for (const x of given) for (const y of numbers) for (const name of names) for (const value of [T[name](x, y), T[name](y, x)])
    out.push([name, value, list[value], map.get(value), pick(value), value === (value | 0), JSON.stringify([value])].join());
console.log(out.join('\n'));
