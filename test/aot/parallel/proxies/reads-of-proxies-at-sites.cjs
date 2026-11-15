// A place that reads a name off proxies enters the trap without asking the tables.
// COUNTER: SiteCacheProxyEntriesStored >= 3
"use strict";
const log = [];
const attempt = f => { try { return String(f()); } catch (e) { return e.name + ": " + e.message; } };
const handler = { get(target, key, receiver) { log.push(typeof key === "string" ? key : "symbol"); return Reflect.get(target, key); } };
class Holder { constructor(n) { this.flags = n; } get twice() { return this.flags * 2; } }
const proxied = n => new Proxy(new Holder(n), handler);
const read = o => o.flags;
const truth = o => (o.flags ? "yes" : "no");
const getter = o => o.twice;
const absent = o => o.nowhere;
let sum = 0;
for (let i = 0; i < 3000; i++) sum += read(proxied(i)) + getter(proxied(i)) + (truth(proxied(i & 1)) === "yes" ? 1 : 0) + (absent(proxied(i)) === undefined ? 1 : 0);
console.log(sum, log.length, [...new Set(log)].join());
log.length = 0;
// The same places meet other objects, callable proxies, and proxies below objects.
const callable = new Proxy(Object.assign(() => 1, { flags: 7 }), handler);
const below = Object.create(proxied(5));
const others = [proxied(1), callable, below, { flags: 3 }, new Holder(4), new Proxy({ flags: 9 }, {}), new Proxy({ flags: 10 }, { get: undefined }), Object.freeze({ flags: 11 }), "text", 5, true, null, undefined, new Proxy({ flags: 12 }, { get: (t, k, r) => (r.other === undefined ? k + "!" : k) }), new Proxy([1, 2], handler)];
for (let round = 0; round < 60; round++) for (const o of others) { const line = attempt(() => read(o)) + " " + attempt(() => truth(o)) + " " + attempt(() => getter(o)) + " " + attempt(() => absent(o)); if (round % 20 === 3) console.log(line, log.length); }
// What a trap throws, what it may not say, and a handler that is taken away.
const fixed = Object.defineProperty({}, "flags", { value: 1, writable: false, configurable: false });
const { proxy, revoke } = Proxy.revocable({ flags: 2 }, handler);
for (let round = 0; round < 80; round++) {
  const line = [attempt(() => read(new Proxy(fixed, { get: () => round & 1 ? 1 : 2 }))), attempt(() => read(new Proxy({}, { get() { throw new Error("from the trap " + round % 3); } }))), attempt(() => truth(new Proxy({}, { get() { throw new Error("at the truth"); } }))), attempt(() => read(new Proxy({}, { get: 5 }))), attempt(() => read(proxy))].join(" | ");
  if (round % 20 === 5) console.log(line);
}
revoke();
console.log(attempt(() => read(proxy)), attempt(() => truth(proxy)));
// Traps that read through the same place, and a stack that ends in one.
const deep = n => (n ? new Proxy({ flags: n }, { get: (t, k) => read(deep(n - 1)) + 1 }) : { flags: 0 });
console.log(read(deep(40)));
let depth = 0;
const endless = new Proxy({}, { get(t, k, r) { depth++; return r.flags; } });
console.log(attempt(() => read(endless)).slice(0, 40), depth > 100);
console.log(attempt(() => truth(endless)).slice(0, 40));
console.log(read(proxied(8)), truth(proxied(0)), getter(proxied(21)), absent(proxied(1)));
