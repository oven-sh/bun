// A closure that Link has lost gets its first property under a key in the stub, by the function and the atom or symbol.
// COUNT: operation:operationAOTPutByValAndCacheSloppy <= 3000
const lost = [x => x];
globalThis.pass = value => lost.length > 5 ? null : value;
const symbol = Symbol("own"), registered = Symbol.for("registered");
const makers = [
  i => globalThis.pass(function named(a, b) { return i + (a | 0); }),
  i => globalThis.pass(a => i + (a | 0)),
  i => globalThis.pass(async () => i),
  i => globalThis.pass({ method(a, b, c) { return i; } }.method),
];
const keys = ["alpha", "beta", symbol, registered, Symbol.toPrimitive, Symbol.toStringTag, "gamma"];
const store = (f, key, value) => { f[key] = value; return f; };
const nameOf = key => typeof key === "symbol" ? key.toString() : key;
for (const key of keys) {
  for (const make of makers) {
    let last, wrong = 0;
    for (let i = 0; i < 300; i++) {
      last = store(make(i), key, i);
      if (last[key] !== i || Reflect.ownKeys(last).at(-1) !== key) wrong++;
      if (i === 150 && globalThis.Bun) Bun.gc(true);
    }
    const descriptor = Object.getOwnPropertyDescriptor(last, key);
    console.log(nameOf(key), wrong, last.name, last.length, typeof last.prototype, Reflect.ownKeys(last).map(nameOf).join(), JSON.stringify(descriptor));
  }
}
// The same store of many keys.
let sum = 0;
for (let i = 0; i < 2000; i++) {
  const key = keys[i % keys.length], other = keys[(i + 3) % keys.length];
  const f = store(store(makers[i % 4](i), key, i), other, 1);
  if (f[key] !== i || f[other] !== 1 || Reflect.ownKeys(f).length < 4) console.log("wrong", i);
  sum += f[key];
}
console.log(sum);
// Keys that are no atoms, that are numbers, that functions have, that nobody has twice.
for (const make of [i => "al" + "pha".slice(0, 3 - (i < 0)), i => i % 3, i => String(i % 3), i => ["name", "length", "prototype"][i % 3], i => "once" + i, i => "__proto__", i => -i, i => i + 0.5, i => ({ toString: () => "alpha" }), i => null, i => undefined, i => "once" + i % 7]) {
  const rows = new Set();
  for (let i = 0; i < 90; i++) {
    const f = makers[i % 4](i), key = make(i);
    store(f, key, "v");
    rows.add(Reflect.ownKeys(f).map(nameOf).join().replace(/once\d+/, "once").replace(/-?\d+(\.5)?/, "number") + " " + String(Object.keys(f).length) + " " + f.name + " " + f.length);
  }
  console.log([...rows].join(" | "));
}
// What lies above changes.
const log = [];
Object.defineProperty(Function.prototype, "alpha", { configurable: true, set(value) { log.push(value); }, get() { return "above"; } });
for (let i = 0; i < 8; i++) { const f = store(makers[i % 4](i), "alpha", i); if (Object.keys(f).length || f.alpha !== "above") console.log("own", i); }
console.log(log.join());
delete Function.prototype.alpha;
Object.defineProperty(Function.prototype, symbol, { configurable: true, value: 1, writable: false });
let refused = 0;
for (let i = 0; i < 40; i++) if (store(makers[i % 4](i), symbol, i + 5)[symbol] === 1) refused++;
delete Function.prototype[symbol];
for (let i = 0; i < 40; i++) { const f = store(makers[i % 4](i), i & 1 ? symbol : "alpha", i); if (f[i & 1 ? symbol : "alpha"] !== i) console.log("lost", i); }
console.log(refused);
