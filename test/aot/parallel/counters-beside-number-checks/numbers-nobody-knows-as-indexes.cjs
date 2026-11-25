'use strict';
// A number that nobody knows enters a loop: the turns reckon with it, and it is the index of the elements that they read and store.
function tally(list, k, n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum = sum + k * 2 - (list[k] === undefined ? .5 : list[k]);
    list[k] = i;
    k = k + 1;
  }
  return [sum, k, list.length, Object.keys(list).slice(-4).join()].join(' ');
}
function down(list, k) {
  let sum = 0;
  while (k >= 0) { sum += list[k] * k; k -= 1; }
  return sum + ' ' + k;
}
const starts = JSON.parse('[0, 1, 5, -1, -3, 2.5, 0.1, 1e3, 4294967294, 4294967295, 2147483646, 9007199254740991, null, "2", "x", true, [1], {}]').concat([-0, NaN, Infinity, undefined]);
const made = { whole: () => [1, 2, 3, 4, 5, 6, 7, 8], parts: () => [.5, 1.5, 2.5, 3.5], mixed: () => [1, 'a', .5, null, {}], holes: () => [1, , 3, , 5], none: () => [], fixed: () => Object.freeze([4, 5, 6]) };
for (const kind of Object.keys(made)) for (const start of starts) {
  const said = [];
  for (const f of [() => tally(made[kind](), start, 6), () => tally(made[kind](), start, 40), () => down(made[kind](), typeof start === 'number' && start < 100 ? start : 3)]) {
    try { said.push(f()); } catch (e) { said.push(e.constructor.name); }
  }
  console.log(kind, Object.is(start, -0) ? '-0' : typeof start, String(start), said.join(' | '));
}
