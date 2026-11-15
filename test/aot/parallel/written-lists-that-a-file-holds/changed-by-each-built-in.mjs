const unseen = (x) => ({ a: x })[JSON.parse('"a"')];
const say = (...all) => console.log(all.map(one => (Object.is(one, -0) ? "-0" : String(one))).join(" "));
const TABLES = [];
const T0 = [3, 10, 17, 24, 31, 38, 45, 52]; TABLES.push(T0);
function sum0() { let s = 0; for (let i = 0; i < T0.length; i++) s += T0[i] * (i + 1); return s; }
const T1 = [3, 10, 17, 24, 31, 38, 45, 52]; TABLES.push(T1);
function sum1() { let s = 0; for (let i = 0; i < T1.length; i++) s += T1[i] * (i + 1); return s; }
const T2 = [3, 10, 17, 24, 31, 38, 45, 52]; TABLES.push(T2);
function sum2() { let s = 0; for (let i = 0; i < T2.length; i++) s += T2[i] * (i + 1); return s; }
const T3 = [3, 10, 17, 24, 31, 38, 45, 52]; TABLES.push(T3);
function sum3() { let s = 0; for (let i = 0; i < T3.length; i++) s += T3[i] * (i + 1); return s; }
const T4 = [3, 10, 17, 24, 31, 38, 45, 52]; TABLES.push(T4);
function sum4() { let s = 0; for (let i = 0; i < T4.length; i++) s += T4[i] * (i + 1); return s; }
const T5 = [3, 10, 17, 24, 31, 38, 45, 52]; TABLES.push(T5);
function sum5() { let s = 0; for (let i = 0; i < T5.length; i++) s += T5[i] * (i + 1); return s; }
const T6 = [3, 10, 17, 24, 31, 38, 45, 52]; TABLES.push(T6);
function sum6() { let s = 0; for (let i = 0; i < T6.length; i++) s += T6[i] * (i + 1); return s; }
const T7 = [3, 10, 17, 24, 31, 38, 45, 52]; TABLES.push(T7);
function sum7() { let s = 0; for (let i = 0; i < T7.length; i++) s += T7[i] * (i + 1); return s; }
const T8 = [3, 10, 17, 24, 31, 38, 45, 52]; TABLES.push(T8);
function sum8() { let s = 0; for (let i = 0; i < T8.length; i++) s += T8[i] * (i + 1); return s; }
const T9 = [3, 10, 17, 24, 31, 38, 45, 52]; TABLES.push(T9);
function sum9() { let s = 0; for (let i = 0; i < T9.length; i++) s += T9[i] * (i + 1); return s; }
const T10 = [3, 10, 17, 24, 31, 38, 45, 52]; TABLES.push(T10);
function sum10() { let s = 0; for (let i = 0; i < T10.length; i++) s += T10[i] * (i + 1); return s; }
const T11 = [3, 10, 17, 24, 31, 38, 45, 52]; TABLES.push(T11);
function sum11() { let s = 0; for (let i = 0; i < T11.length; i++) s += T11[i] * (i + 1); return s; }
const sums = [sum0, sum1, sum2, sum3, sum4, sum5, sum6, sum7, sum8, sum9, sum10, sum11];
const deeds = [(t) => t.reverse(), (t) => t.sort((a, b) => b - a), (t) => t.fill(1, 2, 4), (t) => t.copyWithin(0, 4), (t) => t.pop(), (t) => t.shift(), (t) => t.unshift(9), (t) => t.splice(1, 2, 7), (t) => { t.length = 3; }, (t) => { delete t[2]; }, (t) => Object.defineProperty(t, 1, { value: 500 }), (t) => Object.assign(t, [8, 8])];
const before = sums.map((one) => unseen(one)()); deeds.forEach((deed, k) => unseen(deed)(TABLES[k])); const after = sums.map((one) => unseen(one)());
say(before.join(" ")); say(after.join(" "));
