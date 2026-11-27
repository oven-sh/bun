'use strict';
// x = from[i++] .. to[j++] = x: the next counters are made where the turn comes round. A turn that leaves its version behind a step goes on with counters of its own.
function move(from, to, i, j, n) {
  while (n-- > 0) { const x = from[i++]; if (x < 0) j++; to[j++] = x; }
  return i + ':' + j;
}
function pairs(from, to) {
  let i = 0, j = to.length, k = 0;
  while (i < from.length) { const a = from[i++], b = from[i++]; to[--j] = b; to[k++] = a; }
  return [i, j, k].join(':');
}
function merge(a, b, out) {
  let i = 0, j = 0, k = 0;
  while (i < a.length && j < b.length) out[k++] = a[i] <= b[j] ? a[i++] : b[j++];
  while (i < a.length) out[k++] = a[i++];
  while (j < b.length) out[k++] = b[j++];
  return k;
}
const lists = { whole: () => [5, 3, -8, 1, 9, 2], parts: () => [.5, -1.5, 2.25, 8], mixed: () => [1, 'b', .5, null, -2, {}], holes: () => [1, , -3, , 5], none: () => [], long: () => Array.from({ length: 70 }, (_, i) => (i * 37) % 19 - 4), texts: () => ['b', 'a', 'c'] };
const show = l => l.length > 12 ? l.length + '~' + l.slice(0, 6).map(String).join() + '~' + l.slice(-4).map(String).join() : l.length + '~' + Array.from(l, x => typeof x === 'object' && x ? 'o' : String(x)).join();
for (const from of Object.keys(lists)) for (const to of Object.keys(lists)) {
  const said = [];
  const t = lists[to]();
  for (const f of [() => move(lists[from](), t, 0, 1, 6), () => move(lists[from](), t, 2, 0, 9), () => { const s = lists[from](); return move(s, s, 0, 2, 5) + show(s); }, () => pairs(lists[from](), t), () => { const out = lists[to](); return merge(lists[from]().sort(), lists[to]().sort(), out) + show(out); }, () => move(lists[from](), Object.freeze(lists[to]()), 0, 0, 3)]) {
    try { said.push(f()); } catch (e) { said.push(e.constructor.name); }
  }
  console.log(from, to, said.join(' '), show(t));
}
