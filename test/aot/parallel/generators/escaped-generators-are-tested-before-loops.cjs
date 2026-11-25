// Generators of these functions also go where nobody sees what is done to them. A loop over a call asks the function first.
function* range(from, to, step = 1) { for (let i = from; i <= to; i += step) yield i; }
function* words(list) { try { for (const word of list) { const sent = yield word + "!"; if (sent) console.log("sent", sent); } } finally { console.log("closed", list.length); } }
function* pairs(n) { for (let i = 0; i < n; i++) yield [i, i * i]; }
const sinks = [v => v, v => Object.getPrototypeOf(v), v => Object.getPrototypeOf(Object.getPrototypeOf(v))];
globalThis.sinks = sinks;
function leak(v) { return globalThis.sinks.map(f => typeof f(v)).join(); }
console.log(leak(range(1, 3)), leak(words([])), leak(pairs(1)));
const divisors = n => { const out = []; for (const x of range(1, n)) if (!(n % x)) out.push(x); return out; };
const firstOver = (n, limit) => { for (const x of range(1, n)) if (x * x > limit) return x; return -1; };
function* evens(n) { for (const x of range(0, n)) if (x % 2 === 0) yield x; }
function shout(list) { let out = ""; for (const w of words(list)) { if (w === "stop!") break; out += w; } return out; }
function thrown(list) { for (const w of words(list)) if (w === "bad!") throw new RangeError(w); return list.length; }
function swapped(n) { let s = 0; for (const [a, b] of pairs(n)) s += a * b; return s; }
function labelled(n) { let s = 0; outer: for (let k = 0; k < 2; k++) for (const x of range(k, n)) { if (x === 3) continue outer; s += x; } return s; }
function show() {
  const out = [];
  for (const run of [() => divisors(60).join(), () => firstOver(50, 90), () => [...evens(7)].join(), () => shout(["a", "stop", "b"]), () => shout([]), () => thrown(["bad"]), () => thrown(["x"]), () => swapped(5), () => labelled(5)]) {
    try { out.push(String(run())); } catch (e) { out.push(e.name + " " + e.message); }
  }
  return out.join(" | ");
}
console.log(show());
const own = Object.getPrototypeOf(range(1, 2));
own.extra = 1;
console.log(show(), Object.keys(own).join());
let steps = 0;
own.next = function (...sent) { steps++; return Object.getPrototypeOf(own).next.apply(this, sent); };
console.log(divisors(12).join(), steps, show());
delete own.next; delete own.extra;
words.prototype = { [Symbol.iterator]() { let k = 0; return { next: () => ({ done: k > 1, value: "w" + k++ + "!" }), return() { console.log("own return"); return {}; } }; } };
console.log(shout(["a", "b"]), show());
pairs.prototype = null;
console.log(swapped(4), show());
const iterators = Object.getPrototypeOf(Object.getPrototypeOf(own));
const iterate = iterators[Symbol.iterator];
range.prototype = Object.create(iterators, { [Symbol.iterator]: { value() { return iterate.call([7, 8][Symbol.iterator]()); } } });
console.log(divisors(56).join(), show());
