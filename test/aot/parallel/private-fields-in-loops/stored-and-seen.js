// A private field that a loop stores comes round in a register: whoever sees or stores it in between, in another object, below, through a call, a throw or a proxy, finds what is written.
"use strict";
const log = [];
const tell = v => (Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : typeof v === "string" ? "'" + v : String(v));
class Counter {
  #n = 0; #last = "none"; pub = 0;
  run(k) { for (let i = 0; i < k; i++) this.#n += i & 3; return this.#n; }
  other(k, o) { for (let i = 0; i < k; i++) { this.#n += i; o.#n += 1; if (i === 3) this.#last = o; } return tell(this.#n) + tell(o.#n); }
  called(k, f) { for (let i = 0; i < k; i++) { this.#n += i; f(i, this.#n); } return this.#n; }
  thrown(k) { try { for (let i = 0; i < k; i++) { this.#n += i; if (i === 4) throw this.#n; } } catch (e) { return tell(e) + tell(this.#n); } finally { this.#n += 1000; } return "whole"; }
  *stepped(k) { for (let i = 0; i < k; i++) { this.#n += i; yield this.#n; } }
  nested(k) { for (let i = 0; i < k; i++) { for (let j = 0; j < 3; j++) this.#n += j; this.#last = this.#n; } return tell(this.#n) + tell(this.#last); }
  kinds(list) { for (const x of list) this.#n += x; return tell(this.#n); }
  hash(text) { for (let i = 0; i < text.length; i++) this.#n = (Math.imul(this.#n, 31) + text.charCodeAt(i)) | 0; return this.#n; }
  both(k) { for (let i = 0; i < k; i++) { this.#n += i; this.pub = this.#n; if (i % 3 === 1) continue; if (i === 7) break; this.#n -= 0.5; } return tell(this.#n) + tell(this.pub); }
  first(k) { for (let i = 0; i < k; i++) { this.#last = i; } return tell(this.#last); }
  set(v) { this.#n = v; }
  get seen() { return tell(this.#n); }
  static has(o) { return #n in o; }
}
class Below extends Counter { #n = "own"; own(k) { for (let i = 0; i < k; i++) this.#n += i; return this.#n; } }
class Account { #sum = 0; #events; constructor(events) { this.#events = events; for (const e of this.#events) this.#sum += e; } get sum() { return this.#sum; } }
const note = f => { try { log.push(String(f())); } catch (e) { log.push(e.constructor.name); } };
for (let round = 0; round < 3; round++) for (const make of [() => new Counter(), () => new Below()]) {
  const c = make(), d = make(); if (round) { c.set(round === 1 ? 0.5 : "t"); }
  note(() => c.run(20)); note(() => c.other(9, d)); note(() => c.other(9, c)); note(() => c.called(8, (i, n) => { log.push(i + c.seen + tell(n)); if (i === 5) c.set(7); })); note(() => c.thrown(9)); note(() => c.seen); note(() => c.thrown(3));
  note(() => { let t = ""; for (const x of c.stepped(5)) { t += tell(x) + c.seen; if (x > 1e6) c.set(0); } return t; }); note(() => c.nested(4)); for (const list of [[1, 2, 3], [0.5, -0, NaN], [1, "two", 3], [1n], [2147483647, 2147483647], []]) { const e = make(); note(() => e.kinds(list) + e.seen); }
  note(() => make().hash("some words to mix")); note(() => c.both(12)); note(() => c.first(0) + c.first(5)); note(() => (c.own ? c.own(3) : "none") + c.seen + d.seen); note(() => Counter.has(c) + "" + Counter.has({})); Object.freeze(d); note(() => d.run(5) + d.seen);
  for (const bad of [{}, new Proxy(make(), {}), null, Object.create(make())]) { note(() => Counter.prototype.run.call(bad, 3)); note(() => Counter.prototype.run.call(bad, 0)); note(() => make().other(3, bad)); note(() => Counter.prototype.hash.call(bad, "")); }
}
note(() => new Account([1, 2.5, -3]).sum + " " + new Account(["a", 1]).sum + " " + new Account([]).sum);
console.log(log.join("\n"));
