const trace = [];
const kept = [];
function base() { return { a2: NaN, m2() { return this.a2 * 2; }, nested2: { x2: 1.5 }, d2: 1e21 }; }
function make() {
  const store = base();
  class Made {}
  for (const k of Object.keys(store))
    Object.defineProperty(Made.prototype, k, { get() { trace.push("getter " + k); return store[k]; }, set(v) { trace.push("setter " + k); store[k] = v; }, enumerable: true, configurable: true });
  const value = new Made();
  kept.push(value);
  return kept[kept.length - 1];
}
function call() { return { then(resolve) { resolve(make()); } }; }
function poke() { for (const value of kept) { value.a2 = 5; value.m2 = 7; } }
function drain() { return trace.splice(0).join(); }
module.exports = { call, poke, drain };
