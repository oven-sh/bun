// A field without a written type: the checker finds the class of its first store, and other code stores others.
"use strict";
class CaselessMap {
  constructor(other) { this._map = other == null ? new Map() : new Map(other._map); }
  set(key, value) { this._map.set(key.toLowerCase(), value); }
  has(key) { return this._map.has(key.toLowerCase()); }
  get(key) { return this._map.get(key.toLowerCase()); }
}
class Value { constructor(v) { this._value = v; } apply(state, list) { return this._value + list.length + (state ? 1 : 0); } }
class State {
  constructor(program) { this.values = new CaselessMap(); this.first = new Value(1); this.last = null; this.program = program; }
  getValue(name, n) { if (this.values.has(name)) return this.values.get(name); let made = n ? [n] : new Value(n); this.values.set(name, made); return made; }
}
function call(state, list) { const old = state.values; state.values = new Map(); state.values.set("x", list); let r; try { r = state.getValue("x", list.length); } finally { state.values = old; } return r; }
const out = [];
const makers = [(p) => new State(p), (p) => { const s = new State(p); s.values = new Map([["A", 1]]); return s; }, (p) => { const s = new State(p); s.values = { has: (k) => k === "b", get: () => "own", set() { } }; return s; }, (p) => Object.assign(Object.create(State.prototype), { values: new CaselessMap(), first: 5 }), (p) => { const s = new State(p); s.values = new (class Heir extends CaselessMap { has(k) { return super.has(k) && k !== "c"; } })(); return s; }, (p) => { const s = new State(p); s.values = null; return s; }, (p) => { const s = new State(p); s.values._map = new Map([["a", "replaced"]]); return s; }, (p) => new Proxy(new State(p), {})];
for (let turn = 0; turn < 3; turn++) {
  if (turn === 2) CaselessMap.prototype.get = function (key) { return "above " + key; };
  for (const make of makers) {
    const state = make({ base: turn });
    for (const name of ["A", "a", "b", "C", "c", "A"]) for (let i = 0; i < 3; i++) {
      let r;
      try { r = state.getValue(name, i); r = r && r.apply ? r.apply(state, [i]) : String(r); } catch (e) { r = e.constructor.name; }
      out.push(r);
      try { state.last = state.first; state.first = i & 1 ? new Value(i) : state.values; out.push(typeof state.last, state.first instanceof Value); } catch (e) { out.push(e.constructor.name); }
    }
    try { out.push(call(state, [1, 2])); } catch (e) { out.push(e.constructor.name); }
  }
}
console.log(out.join());
