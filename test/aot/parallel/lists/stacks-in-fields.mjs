// Stacks and queues in fields: pushes and pops in loops, the list read by the loop itself, replaced in the middle, of other kinds, with an own push.
class Stack { items = []; constructor(l) { if (l) this.items = l; } push(x) { this.items.push(x); } pop() { return this.items.pop(); } peek() { return this.items[this.items.length - 1]; } get size() { return this.items.length; } }
const show = x => (Object.is(x, -0) ? "-0" : Array.isArray(x) ? "[" + Array.from(x, show).join() + "]" : String(x));
function decreasing(s, L) { let t = 0; for (let i = 0; i < L.length; i++) { const x = L[i]; if (s.size > 0 && s.peek() > x) t += s.pop(); else s.push(x); } return t; }
function bounded(s, L) { let t = 0; for (let i = 0; i < L.length; i++) { s.push(L[i]); if (s.size > 3) t += s.pop(); } return t; }
function monotonic(s, L) { let t = 0; for (let i = 0; i < L.length; i++) { while (s.size > 0 && L[s.peek()] < L[i]) s.pop(); t += s.size > 0 ? s.peek() : 0; s.push(i); } return t; }
function emptied(s, L) { let t = 0; for (let i = 0; i < L.length + 3; i++) { const x = s.pop(); if (x === undefined) { t += 1000; s.push(i); } else t += x; } return t; }
function own(s) { const l = s.items; let t = 0; for (let i = 0; i < l.length && i < 12; i++) { s.push(l[i]); if (i & 1) t += s.pop(); } return t; }
function replaced(s, L) { for (let i = 0; i < L.length; i++) { s.push(L[i]); if (i === 2) s.items = [0.5]; } return s.size; }
function record(L) { const q = { items: [], sum: 0 }; for (let i = 0; i < L.length; i++) { q.items.push(L[i] * 2); if (q.items.length === 4) q.sum += q.items.pop(); } return [q.sum, q.items]; }
const inputs = [() => [5, 3, 8, 1, 9, 2, 7], () => [1.5, 0.5, 2.5, 2], () => [2147483647, 2147483648, -1], () => [3, , 1], () => ["b", "a"], () => [], () => [NaN, -0, 0, 1], () => Int32Array.from([3, 1, 2])];
const starts = [() => undefined, () => [1, 2], () => [0.5], () => ["x"], () => [1, , 2], () => new Array(3), () => Object.freeze([4]), () => Object.defineProperty([7], "push", { value() { return 9; } }), () => new (class extends Array {})()];
for (let turn = 0; turn < 3; turn++)
  for (const run of [decreasing, bounded, monotonic, emptied, own, replaced, (s, L) => record(L)])
    for (const input of inputs)
      for (const start of starts) {
        const s = new Stack(start());
        let said;
        try { said = show(run(s, input())); } catch (e) { said = "!" + e.constructor.name; }
        if (turn === 0 || said.length % 7 === turn) console.log(run.name, said, show(s.items).slice(0, 80));
      }
