"use strict";
const unseen = (x) => ({ a: x })[JSON.parse('"a"')];
const show = (value) => JSON.stringify(value, (key, each) => (typeof each === "number" && !Number.isFinite(each) ? String(each) : Object.is(each, -0) ? "-0" : each));
function one(a) { return [a | 0]; }
function two(a, b) { return [a | 0, b | 0]; }
function three(a, b) { return [a | 0, b | 0, -2147483648]; }
function four(a, b) { return [a | 0, b | 0, 2147483647, a & b]; }
function five(a, b) { return [a | 0, b | 0, 3, 4, a ^ b]; }
function seventeen(a) { return [a | 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, a & 1]; }
function fractions(a, b) { return [a * 0.5, b * 0.5]; }
function quotients(a, b) { return [a / b, b / a, a * 0.5]; }
function fiveQuotients(a, b) { return [a / b, b / a, 1.5, a * b, a - b]; }
function minusZero(a) { return [a * -0, a * 0.5]; }
function sums(a, b) { return [(a | 0) + (b | 0), (a | 0) - (b | 0)]; }
function rows(a) { return [[a | 0, 1], [a * 0.5, 2], [a / 0, 0 / a]]; }
function held(a) { return { row: [a | 0, 2], other: [a * 0.5], deeper: { row: [a | 0] } }; }
console.log(show([unseen(one)(7), unseen(two)(1.9, -2.9), unseen(three)(1e10, "5"), unseen(four)(6, 3), unseen(five)(6, 3), unseen(seventeen)(9)]));
console.log(show([unseen(fractions)(1, 3), unseen(quotients)(0, 0), unseen(quotients)(1, 0), unseen(fiveQuotients)(0, 0), unseen(minusZero)(3), unseen(sums)(2147483647, 1), unseen(sums)(-2147483648, 1)]));
console.log(show([unseen(rows)(0), unseen(rows)(3), unseen(held)(5)]));
const nan = unseen(quotients)(0, 0); console.log(0 in nan, 1 in nan, nan.length, Number.isNaN(nan[0]), nan.indexOf(NaN), nan.includes(NaN), Object.is(unseen(minusZero)(3)[0], -0));
const changed = [unseen(two)(1, 2), unseen(two)(1, 2), unseen(two)(1, 2), unseen(fractions)(1, 3), unseen(fractions)(1, 3), unseen(fractions)(1, 3), unseen(four)(1, 2)];
changed[0][0] = 0.5; changed[1].push("text"); changed[2][5] = 7; changed[3][0] = "text"; changed[4][1] = NaN; delete changed[5][0]; changed[6].length = 1;
console.log(show(changed), 3 in changed[2], 0 in changed[5], Number.isNaN(changed[4][1]));
function total(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i] * 2; return s; }
console.log(unseen(total)(unseen(five)(6, 3)), unseen(total)(unseen(fractions)(1, 3)), unseen(total)(unseen(quotients)(1, 2)), unseen(total)(changed[0]), unseen(total)(unseen(seventeen)(4)));
let all = 0; for (let t = 0; t < 200; t++) { const [a, b] = two(t, t + 1); const f = fractions(t, 3); const r = rows(t); all += a + b + f[0] + f[1] + r[0][0] + r[1][0] + total(four(t, 2)); }
console.log(all);
