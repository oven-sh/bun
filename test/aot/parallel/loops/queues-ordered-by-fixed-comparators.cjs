// STATISTIC: ComparatorsKeptInlined >= 1
// A priority queue whose comparator is stored once: strings, which take the generic version, have the comparator inlined too.
class Queue {
  constructor(less) { this.items = []; this.less = less; }
  push(x) { const h = this.items; let i = h.length; h.push(x); while (i > 0) { const p = (i - 1) >> 1; if (!this.less(h[i], h[p])) break; const t = h[i]; h[i] = h[p]; h[p] = t; i = p; } }
  pop() { const h = this.items, top = h[0], last = h.pop(); if (h.length) { h[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < h.length && this.less(h[l], h[m])) m = l; if (r < h.length && this.less(h[r], h[m])) m = r; if (m === i) break; const t = h[i]; h[i] = h[m]; h[m] = t; i = m; } } return top; }
}
const below = (a, b) => a < b, above = (a, b) => a > b, byRank = (a, b) => (a ?? 0).rank < (b ?? 0).rank;
let calls = 0;
const kinds = { real: i => Math.sin(i * 7 + 1), whole: i => (i * 5) % 7 - 3, text: i => "t" + (i * 7) % 11, object: i => ({ rank: (i * 5) % 7, valueOf() { calls++; return this.rank; } }), mixed: i => i % 3 ? i / 2 : "x" + i, big: i => i % 4 === 3 ? 10n : i, nan: i => i % 5 ? (i * 3) % 4 / 2 : NaN, none: i => i % 6 === 2 ? undefined : i };
const show = value => value === undefined ? "u" : typeof value === "object" && value ? "o" + value.rank : typeof value === "bigint" ? value + "n" : String(value);
for (const name in kinds) for (const less of [0, 1, 2]) {
  const queue = new Queue(less === 0 ? below : less === 1 ? above : byRank), out = [];
  for (let i = 0; i < 17; i++) queue.push(kinds[name](i));
  if (less === 1) queue.items[4] = 0.5;
  for (let i = 0; i < 18; i++) out.push(show(queue.pop()));
  console.log(name, less, out.join(), calls);
}
