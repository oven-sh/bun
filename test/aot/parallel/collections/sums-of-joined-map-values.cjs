// STATISTIC: JoinsCarriedUnboxed <= 0
// A value that may be undefined and is only added to a constant stays boxed across the join behind its lookup.
"use strict";
function counted(m, list) {
  for (const k of list) {
    if (m.has(k)) m.set(k, m.get(k) + 1);
    else m.set(k, 2147483645);
  }
  return m;
}
function stepped(m, list) {
  for (const k of list) {
    if (m.has(k)) m.set(k, m.get(k) - 3);
    else m.set(k, k & 1 ? -2147483645 : undefined);
  }
  return m;
}
const list = Array.from({ length: 90 }, (_, k) => (k * 7) % 11);
const show = m => [...m].map(([k, v]) => k + "=" + (Object.is(v, -0) ? "-0" : v)).join(" ");
console.log(show(counted(new Map(), list)), show(stepped(new Map(), list)));
const mixed = new Map([[0, 0.5], [1, -0], [2, NaN], [3, 1e300], [4, undefined], [5, -1]]);
console.log(show(counted(mixed, list)), show(stepped(mixed, list)));
