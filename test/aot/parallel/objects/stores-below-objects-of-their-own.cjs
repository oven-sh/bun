// Objects that each stand below an object of their own are asked name by name. A filter of all names above is filled where a Structure is stored to often.
// COUNTER: AbsenceFiltersFilled <= 40
"use strict";
const attempt = f => { try { return String(f()); } catch (e) { return e.name + ": " + e.message; } };
const call = Function.prototype.call, apply = Function.prototype.apply, log = [];
class Base { get first() { return 1; } get second() { return 2; } set third(v) { log.push("third " + v); } get fourth() { return 4; } method() { return 5; } other() { return 6; } }
for (let i = 0; i < 60; i++) Object.defineProperty(Base.prototype, "name" + i, { get() { return i; }, configurable: true });
function below(above, early) {
  const made = Object.create(above);
  made.call = call;
  made.apply = apply;
  if (early) made.third = early;
  return made;
}
let sum = 0;
for (let i = 0; i < 2000; i++) { const made = below(new Base()); sum += (made.call === call) + (made.apply === apply) + made.first + made.method(); }
console.log(sum, log.length);
console.log(Object.keys(below(new Base(), 3)).join(), log.join());
// Above them something stops the store: a setter, a value that stays, a frozen object, a proxy.
const frozen = new Base(); Object.defineProperty(frozen, "call", { value: 1, writable: false, configurable: true });
const withSetter = new Base(); Object.defineProperty(withSetter, "apply", { set(v) { log.push("apply set"); }, configurable: true });
const proxied = new Proxy(new Base(), { set(t, k, v, r) { log.push("trap " + k); return Reflect.set(t, k, v, r); } });
for (let round = 0; round < 12; round++) console.log(attempt(() => Object.keys(below(frozen)).join()), attempt(() => Object.keys(below(withSetter)).join()), attempt(() => Object.keys(below(proxied)).join()), log.splice(0).join());
// The object above changes between two stores of one Structure, and the prototype of its class.
for (let round = 0; round < 8; round++) {
  const above = new Base(), made = Object.create(above);
  made.call = round;
  Object.defineProperty(above, "apply", { get() { return "above"; }, configurable: true });
  console.log(attempt(() => { made.apply = round; return made.apply; }), Object.keys(made).join());
  delete above.apply;
  console.log(attempt(() => { made.apply = round; return made.apply; }), Object.keys(made).join());
  if (round === 5) Object.defineProperty(Base.prototype, "apply", { get() { return "base"; }, configurable: true });
  if (round === 6) delete Base.prototype.apply;
}
