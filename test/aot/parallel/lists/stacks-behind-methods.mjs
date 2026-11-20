// Stacks whose methods stand between the loop and the list: made here, kept in a module, handed in, under two names, of other kinds, replaced, empty, with elements that are no numbers.
class Stack { items = []; push(x) { this.items.push(x); } pop() { return this.items.pop(); } peek() { return this.items[this.items.length - 1]; } get size() { return this.items.length; } clear() { this.items = []; } }
const kept = new Stack(), twin = kept, held = { stack: new Stack() };
let replaced = new Stack();
const show = x => (Object.is(x, -0) ? "-0" : Array.isArray(x) ? "[" + Array.from(x, show).join() + "]" : x === undefined ? "u" : typeof x === "object" && x ? "o" : String(x));
function decreasing(s, L) { let t = 0; for (let i = 0; i < L.length; i++) { const x = L[i]; if (s.size > 0 && s.peek() > x) t += s.pop(); else s.push(x); } return t; }
function made(L) { const s = new Stack(); return [decreasing(s, L), s.items]; }
function own(L) { const s = new Stack(); let t = 0; for (let i = 0; i < L.length; i++) { const x = L[i]; if (s.size > 0 && s.peek() > x) t += s.pop(); else s.push(x); } return [t, s.items]; }
function module(L) { let t = 0; for (let i = 0; i < L.length; i++) { const x = L[i]; if (kept.size > 0 && kept.peek() > x) t += kept.pop(); else kept.push(x); } return [t, kept.items]; }
function aliased(L) { let t = 0; for (let i = 0; i < L.length; i++) { kept.push(L[i]); if (twin.size > 4) t += twin.pop(); if (i === 3) twin.push(0.5); } return [t, kept.items.length]; }
function bounded(L) { const s = new Stack(); let t = 0; for (let i = 0; i < L.length; i++) { s.push(L[i]); if (s.size > 2) t += s.pop(); } return [t, s.items]; }
function emptied(L) { const s = new Stack(); let t = 0; for (let i = 0; i < L.length; i++) { const x = s.pop(); if (x === undefined) { t += 1000; s.push(L[i]); } else t += x; } return [t, s.items]; }
function peeked(L) { const s = new Stack(); let t = 0; for (let i = 0; i < L.length; i++) { t += s.peek() > L[i] ? 1 : 2; s.push(L[i]); } return [t, s.items]; }
function cleared(L) { const s = held.stack; let t = 0; for (let i = 0; i < L.length; i++) { s.push(L[i]); if (i === 2) s.clear(); if (s.size > 1) t += s.pop(); } return [t, s.items]; }
function swapped(L) { let t = 0; for (let i = 0; i < L.length; i++) { replaced.push(L[i]); if (i === 2) replaced = new Stack(); if (replaced.size > 1) t += replaced.pop(); } return [t, replaced.items]; }
function mixed(L) { const s = new Stack(); let t = 0; for (let i = 0; i < L.length; i++) { s.push(i & 1 ? L[i] : "t" + i); if (s.size > 2) t += s.pop(); } return [t, s.items]; }
function monotonic(L) { const q = []; let t = 0; for (let i = 0; i < L.length; i++) { while (q.length > 0 && L[q[q.length - 1]] < L[i]) q.pop(); t += q.length > 0 ? q[q.length - 1] : 0; q.push(i); } return [t, q]; }
const shared = { items: ["a"], n: 0 };
function first(L) { const s = shared; let t = 0; for (let i = 0; i < L.length; i++) { t = s.items.pop(); if (t === undefined) { t = 5; s.items.push(L[i]); } if (s.items.length > 1) t += s.items[0]; } return [t, s.items]; }
function drained(L) { const q = []; for (let i = 0; i < L.length; i++) q.push(L[i]); let t = 0; while (q.length > 1) t += q.pop() - q[0]; return [t, q]; }
function given(s, L) { let t = 0; for (let i = 0; i < L.length; i++) { const x = L[i]; if (s.size > 0 && s.peek() > x) t += s.pop(); else s.push(x); } return [t, s.items]; }
const inputs = [() => [5, 3, 8, 1, 9, 2, 7], () => [1.5, 0.5, 2.5, 2, 0.25], () => [2147483647, 2147483648, -1, 4], () => [3, , 1, 2], () => ["b", "a", "c"], () => [], () => [NaN, 1, -0, 0], () => [undefined, 4, null, 2], () => Float64Array.from([3, 1.5, 2])];
const starts = [() => [], () => [1, 2], () => [0.5], () => ["x"], () => [1, , 2], () => Object.freeze([4]), () => undefined];
for (let turn = 0; turn < 3; turn++) {
  for (const input of inputs) {
    for (const run of [made, own, module, aliased, bounded, emptied, peeked, cleared, swapped, mixed, monotonic, first, drained]) {
      let said;
      try { said = show(run(input())); } catch (e) { said = "!" + e.constructor.name; }
      console.log(run.name, said.slice(0, 90));
    }
    kept.items = turn === 1 ? [0.5, 1] : [];
    for (const start of starts) {
      const s = new Stack();
      s.items = start();
      let said;
      try { said = show(given(s, input())); } catch (e) { said = "!" + e.constructor.name; }
      if (turn !== 1) console.log("given", said.slice(0, 90));
    }
  }
}
