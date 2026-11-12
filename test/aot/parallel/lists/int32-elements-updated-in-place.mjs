let later = () => {};
function step(x) { return (x | 0) + 3; }
const makers = [
  () => { const list = []; for (let k = 0; k < 24; k++) list.push(k & 3); return list; },
  () => { const list = []; for (let k = 0; k < 24; k++) list.push(2147483600 + k * 2); return list; },
  () => { const list = new Array(24); for (let k = 0; k < 24; k += 3) list[k] = k; return list; },
  () => { const list = []; for (let k = 0; k < 24; k++) list.push(k * 0.5); return list; },
  () => [1, 2.5, 3, "t", 5, undefined, 7, null, 9, true, 11, 12],
  () => { const list = []; for (let k = 0; k < 24; k++) list.push(k); later = () => { list[5] = 0.5; }; return list; },
  () => { const list = []; for (let k = 0; k < 24; k++) list.push(k); later = () => { delete list[5]; }; return list; },
];
class Holder { #list; constructor(list) { this.#list = list; this.list = list; } add(d) { for (let i = 0; i < this.#list.length; i++) this.#list[i] += d; } count() { for (let i = 0; i < this.list.length; i++) this.list[i]++; } }
function plus(L, d) { for (let i = 0; i < L.length; i++) L[i] += d; }
function masks(L, d) { for (let i = L.length - 1; i >= 0; i--) L[i] ^= d; }
function changes(L, d) { for (let i = 0; i < L.length; i++) { const x = L[i]; if (i === 3) later(); L[i] = x + d; } }
function calls(L) { for (let i = 0; i < L.length; i++) { const x = L[i]; step(x); L[i] = step(x) - 2; } }
function beyond(L, d) { for (let i = 0; i < L.length + 1 && i < 30; i++) L[i] = L[i] + d; }
function told(L) { return Array.from(L, (x, k) => (k in L ? typeof x === "number" ? String(x) : typeof x : "hole")).slice(0, 26).join(); }
for (const make of makers) {
  const L = make();
  const holder = new Holder(L);
  for (let t = 0; t < 12; t++) {
    plus(L, t & 7); masks(L, t); holder.add(t); holder.count(); changes(L, 1); calls(L);
    if (t === 4) later();
    if (t === 8) beyond(L, 2);
  }
  console.log(told(L), L.length);
}
