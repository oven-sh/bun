'use strict';
const given = JSON.parse('[true,false,null]'), numbers = JSON.parse('[-1,-0.5,0,-0,-3,2.5,4,-4]');
const names = JSON.parse('["plus","minus","times","over","rest","rawPlus","rawMinus","rawTimes","rawOver","minusRaw","overRaw"]');
const T = {
    plus(x, y) { return x + y; }, minus(x, y) { return x - y; }, times(x, y) { return x * y; }, over(x, y) { return x / y; }, rest(x, y) { return x % y; },
    rawPlus(x, y) { const s = y * 0.5; return s + x; }, rawMinus(x, y) { const s = y * 0.5; return s - x; }, rawTimes(x, y) { const s = y * 0.5; return s * x; },
    rawOver(x, y) { const s = y * 0.5; return s / x; }, minusRaw(x, y) { const s = y * 0.5; return x - s; }, overRaw(x, y) { const s = y * 0.5; return x / s; },
};
const n = Number(process.argv[2] ?? 2), out = [];
const text = value => Object.is(value, -0) ? '-0' : typeof value + ' ' + String(value);
for (let t = 0; t < n; t++) for (const x of given) for (const y of numbers) for (const name of names) out.push(name + ' ' + text(T[name](x, y)) + ' ' + text(T[name](y, x)));
console.log(out.join('\n'));
