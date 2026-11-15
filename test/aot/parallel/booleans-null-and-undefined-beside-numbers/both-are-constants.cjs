'use strict';
const given = JSON.parse('[true,false,null]').concat(undefined);
const names = JSON.parse('["plus","minus","times","over","rest","less","lessEq","greater","greaterEq"]');
const T = {
    plus(x, y) { return x + y; }, minus(x, y) { return x - y; }, times(x, y) { return x * y; }, over(x, y) { return x / y; }, rest(x, y) { return x % y; },
    less(x, y) { return x < y; }, lessEq(x, y) { return x <= y; }, greater(x, y) { return x > y; }, greaterEq(x, y) { return x >= y; },
};
const n = Number(process.argv[2] ?? 2), out = [];
const text = value => Object.is(value, -0) ? '-0' : typeof value + ' ' + String(value);
for (let t = 0; t < n; t++) for (const x of given) for (const y of given) for (const name of names) out.push(name + ' ' + text(T[name](x, y)));
console.log(out.join('\n'));
