// STATISTIC: SlotsCarriedAroundLoops >= 3
"use strict";
// A method fills the fields of an object before a loop updates them. Nothing takes them out again.
class Timer {
  start() { this.ticks = 0; this.total = 0; }
  tick(n) { this.ticks++; this.total += n; return this.ticks; }
}
function ticks(n) {
  const timer = new Timer();
  timer.start();
  let sum = 0;
  for (let k = 0; k < n; k++) sum += timer.tick(k & 7);
  return [sum, timer.ticks, timer.total];
}
class Reader {
  reset(bytes) { this.bytes = bytes; this.offset = 0; return this; }
  number() {
    let result = 0, shift = 0;
    for (;;) {
      const byte = this.bytes[this.offset++];
      result |= (byte & 127) << shift;
      if (!(byte & 128)) return result;
      shift += 7;
    }
  }
}
function numbers(bytes) {
  const reader = new Reader();
  const list = [];
  for (let round = 0; round < 2; round++) {
    reader.reset(bytes);
    while (reader.offset < bytes.length) list.push(reader.number());
  }
  return list.join();
}
class Scanner {
  run(text) {
    this.text = text;
    this.at = 0;
    this.line = 1;
    let sum = 0;
    while (this.at < this.text.length) {
      const c = this.text.charCodeAt(this.at);
      if (c === 10) this.line++;
      sum = (sum * 31 + c) | 0;
      this.at++;
    }
    return [sum, this.at, this.line];
  }
}
class Half { start(n) { this.a = n; if (n > 2) throw new Error("half"); this.b = n; } run(n) { for (let k = 0; k < n; k++) { this.a += 1; this.b += this.a; } return [this.a, this.b]; } }
class Fraction { start(n) { this.x = n; } run(n) { for (let k = 0; k < n; k++) { this.x++; this.x /= 2; } return this.x; } }
class Wide { start(n) { this.x = n; } run(n) { for (let k = 0; k < n; k++) this.x += 1; return this.x; } down(n) { for (let k = 0; k < n; k++) this.x--; return this.x; } }
class Two { start() { this.n = 0; } both(other, n) { for (let k = 0; k < n; k++) { this.n++; other.n += 2; } return [this.n, other.n]; } }
class Grows { start() { this.n = 0; } call(f, n) { for (let k = 0; k < n; k++) { this.n++; f(this, k); } return this.n; } }
class Base { start() { this.n = 1; } }
class Heir extends Base { start() { super.start(); this.m = 2; } run(k) { while (k--) { this.n += this.m; this.m++; } return [this.n, this.m]; } }
const show = (f) => { try { return JSON.stringify(f()) ?? "undefined"; } catch (error) { return error.constructor.name + " " + error.message.slice(0, 4); } };
for (const n of [0, 1, 7, 1000]) console.log(n, show(() => ticks(n)));
console.log(numbers(Uint8Array.from({ length: 60 }, (_, i) => (i % 3 ? i | 128 : i & 127))));
console.log(show(() => numbers([200, 1.5, 300, 3])));
for (const text of ["", "a", "one\ntwo\n\nthree", "\u{1f600}x"]) console.log(show(() => new Scanner().run(text)));
for (const n of [0, 2, 3]) { const half = new Half(); console.log(show(() => half.start(n)), show(() => half.run(3)), show(() => half.run(2)), Object.keys(half).join()); }
for (const n of [0, 1.5, -0, NaN, Infinity, 2 ** 31 - 3, 2 ** 53 - 2, -(2 ** 31) + 2]) {
  const f = new Fraction(), w = new Wide();
  f.start(n); w.start(n);
  console.log(String(f.run(5)), String(w.run(6)), String(w.down(12)), Object.is(w.x, -0));
}
{ const unfilled = new Wide(); console.log(String(unfilled.run(2)), Object.keys(unfilled).join()); }
{ const a = new Two(), b = new Two(); a.start(); b.start(); console.log(show(() => a.both(b, 5)), show(() => a.both(a, 5)), show(() => new Two().both(a, 3))); }
{ const g = new Grows(); g.start(); console.log(show(() => g.call((o, k) => { if (k === 2) o.start(); if (k === 4) o.n = 1.5; }, 8)), show(() => g.call(() => {}, 3))); }
{ const h = new Heir(); console.log(show(() => h.run(2))); h.start(); console.log(show(() => h.run(3)), show(() => h.run(0))); }
