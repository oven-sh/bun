"use strict";
const log = [];
function pad(x) { let s = 0; for (let i = 0; i < 3; i++) { s += x + i; s ^= i; s += x * 2; s -= i; s |= 0; s += 7; s ^= x; s += 11; s -= 3; s += x & 5; s ^= 9; s += 13; s -= x >> 1; s += 17; } return s; }
// A getter in the head: it must run once a call.
const counted = { reads: 0, get flag() { this.reads++; return this.reads % 3 === 0; }, value: 5 };
function headWithGetter(o) { if (o.flag) return o.value; log.push("g"); return pad(o.value) + pad(1) + pad(2); }
// valueOf in a comparison of the head.
const weighs = { asked: 0, valueOf() { this.asked++; return this.asked; } };
function headWithValueOf(o) { if (o < 3) return -1; log.push("v"); return pad(2) + pad(3) + pad(4); }
// A proxy.
let traps = 0;
const proxied = new Proxy({ done: false, value: 1 }, { get(t, k) { traps++; return t[k]; } });
function headWithProxy(o) { if (o.done) return o.value; log.push("p"); return pad(5) + pad(6) + pad(7); }
// The head throws: once, with the right message, under and outside a handler.
function headThatThrows(o) { if (o.inner.flag) return 1; log.push("t"); return pad(8) + pad(9) + pad(10); }
// A variable in its dead zone.
function deadZone(early) { function read() { if (late > 1) return late; log.push("z"); return pad(late) + pad(11) + pad(12); } if (early) return read(); let late = 1; return read(); }
// Recursion: the head of the function inside itself.
function recursive(n) { if (n <= 0) return 0; log.push("r" + n); return pad(n) - pad(n) + 1 + recursive(n - 1) + recursive(n - 2) * 0; }
// Rest, arguments, this.
function withRest(first, ...rest) { if (!(rest.length > 0)) return first; log.push("x" + rest.length); return pad(first) + pad(rest[0]) + pad(rest.length); }
function withArguments(a) { if (arguments.length < 2) return a; log.push("a" + arguments.length); return pad(a) + pad(arguments[1]) + pad(13); }
function withThis() { if (!(this !== undefined)) return "none"; if (this.skip) return "skip"; log.push("h"); return pad(this.n) + pad(14) + pad(15); }
function attempt(f) { try { return f(); } catch (e) { return e.constructor.name; } }
function run() {
  const out = [];
  for (let i = 0; i < 7; i++) out.push(headWithGetter(counted), headWithValueOf(weighs), headWithProxy(proxied));
  out.push(counted.reads, weighs.asked, traps);
  out.push(attempt(() => headThatThrows({})), attempt(() => headThatThrows({ inner: { flag: 1 } })), attempt(() => headThatThrows({ inner: {} })), attempt(() => headThatThrows(null)));
  out.push(attempt(() => deadZone(true)), attempt(() => deadZone(false)), recursive(4));
  out.push(withRest(1), withRest(1, 2), withRest(1, 2, 3), withArguments(1), withArguments(1, 2), withThis(), withThis.call({ skip: true }), withThis.call({ n: 3 }));
  return out.join() + " | " + log.join("");
}
module.exports = { run, log };
