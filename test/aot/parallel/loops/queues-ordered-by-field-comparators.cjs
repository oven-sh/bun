// STATISTIC: ElementsComparedByCallees >= 1
// A priority queue whose comparator is a field: the comparator that the field holds in front of a loop names what the array holds. Numbers, strings, holes, NaN, objects, comparators that change the queue, its array or the field give the answers of the written loop.
const show = value => value === undefined ? "u" : Object.is(value, -0) ? "-0" : Array.isArray(value) ? "[" + Array.from({ length: Math.min(value.length, 30) }, (_, i) => i in value ? show(value[i]) : "!").join() + "]" + value.length : typeof value === "object" && value ? "o" + value.v : typeof value === "bigint" ? value + "n" : typeof value === "function" ? "f" : String(value);
class Queue {
  constructor(less) { this.items = []; this.less = less; }
  push(x) { const h = this.items; let i = h.length; h.push(x); while (i > 0) { const p = (i - 1) >> 1; if (!this.less(h[i], h[p])) break; const t = h[i]; h[i] = h[p]; h[p] = t; i = p; } }
  pop() { const h = this.items, top = h[0], last = h.pop(); if (h.length) { h[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < h.length && this.less(h[l], h[m])) m = l; if (r < h.length && this.less(h[r], h[m])) m = r; if (m === i) break; const t = h[i]; h[i] = h[m]; h[m] = t; i = m; } } return top; }
  least() { const h = this.items; let m = 0; for (let i = 1; i < h.length; i++) if (this.less(h[i], h[m])) m = i; return m; }
}
class Ranks {
  constructor(order) { this.list = []; this.order = order; }
  add(x) { this.list.push(x); for (let i = this.list.length - 1; i > 0 && this.order(this.list[i], this.list[i - 1]) < 0; i--) { const t = this.list[i]; this.list[i] = this.list[i - 1]; this.list[i - 1] = t; } }
}
let held, calls = 0;
const below = (a, b) => a < b, above = (a, b) => a > b, up = (a, b) => a - b, byValue = (a, b) => a.v - b.v;
const loud = function (a, b) {
  calls++;
  if (held && calls % 11 === 5) held.items[calls % 4] = calls % 2 ? 0.5 : "late";
  if (held && calls % 29 === 7) held.less = above;
  if (held && calls % 37 === 9) held.items = held.items.slice();
  return a < b;
};
const kinds = { real: i => Math.sin(i * 7 + 1), whole: i => (i * 5) % 7 - 3, text: i => "t" + (i * 7) % 5, object: i => ({ v: (i * 5) % 7, valueOf() { calls++; if (held && calls % 13 === 3) held.less = below; return this.v; } }), mixed: i => i % 3 ? i / 2 : "x" + i, zero: i => i % 4 ? -0 : 0, missing: i => (i * i) % 5 === 4 ? undefined : i - i * i / 2, big: i => i % 4 === 3 ? 10n : i, nan: i => i % 5 ? (i * 3) % 4 / 2 : NaN };
for (const name in kinds) for (let turn = 0; turn < 6; turn++) {
  const queue = new Queue(turn % 3 === 0 ? below : above), ranks = new Ranks(turn % 2 ? up : byValue), out = [];
  if (turn > 3) { held = queue; queue.less = loud; } else held = undefined;
  const add = x => { try { queue.push(x); } catch (error) { out.push(error.constructor.name); } try { ranks.add(x); } catch (error) { out.push(error.constructor.name); } };
  for (let i = 0; i < 14; i++) {
    add(kinds[name](i));
    if (i === 9 && turn === 2) delete queue.items[2];
    if (i === 10 && turn === 1) queue.items[3] = 0.25;
    if (i === 11 && turn === 5) Object.freeze(queue.items);
    if (i % 4 === 3) try { out.push(queue.pop(), queue.least()); } catch (error) { out.push(error.constructor.name); }
  }
  for (let i = 0; i < 12; i++) try { out.push(queue.pop()); } catch (error) { out.push(error.constructor.name); }
  console.log(name, turn, out.map(show).join(), show(ranks.list), calls);
}
