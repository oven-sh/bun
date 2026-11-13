// STATISTIC: KnownHelperCalls >= 22
// Private members as esbuild writes them for targets without them.
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateIn = (member, obj) => Object(obj) !== obj ? __typeError('Cannot use the "in" operator on this value') : member.has(obj);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);
var __privateWrapper = (obj, member, setter, getter) => ({
  set _(value) {
    __privateSet(obj, member, value, setter);
  },
  get _() {
    return __privateGet(obj, member, getter);
  }
});
var log = [];
function attempt(f) { try { log.push(String(f())); } catch (e) { log.push(e.name + ": " + e.message); } }
var _total, _step, _Counter_instances, once_fn, twice_get, total_set;
class Counter {
  constructor(step) {
    __privateAdd(this, _Counter_instances);
    __privateAdd(this, _total, 0);
    __privateAdd(this, _step);
    __privateSet(this, _step, step);
  }
  add(times) {
    for (let i = 0; i < times; i++) __privateMethod(this, _Counter_instances, once_fn).call(this);
    return __privateGet(this, _total);
  }
  get double() { return __privateGet(this, _Counter_instances, twice_get); }
  set total(v) { __privateSet(this, _Counter_instances, v, total_set); }
  bump() { return [__privateWrapper(this, _total)._++, ++__privateWrapper(this, _total)._, __privateWrapper(this, _total)._--, __privateGet(this, _total)].join(); }
  static raise(o) { __privateWrapper(o, _total)._++; return --__privateWrapper(o, _step)._; }
  static is(o) { return __privateIn(_total, o) && __privateIn(_Counter_instances, o); }
  static peek(o) { return __privateGet(o, _total); }
  static poke(o, v) { return __privateSet(o, _total, v); }
  static again(o) { return __privateAdd(o, _total, 5) === _answer(); }
  static brand(o) { __privateAdd(o, _Counter_instances); return "branded"; }
  static twice(o) { return __privateGet(o, _Counter_instances, twice_get); }
  static change(o, v) { return __privateSet(o, _Counter_instances, v, total_set); }
}
function _answer() { return undefined; }
_total = new WeakMap();
_step = new WeakMap();
_Counter_instances = new WeakSet();
once_fn = function() {
  __privateSet(this, _total, __privateGet(this, _total) + __privateGet(this, _step));
};
twice_get = function() {
  return __privateGet(this, _total) * 2;
};
total_set = function(v) {
  __privateSet(this, _total, v);
};
class Below extends Counter { constructor() { super("b"); this.own = 1; } }
var a = new Counter(2), b = new Below();
attempt(() => a.add(3));
attempt(() => b.add(2));
attempt(() => a.double);
attempt(() => (a.total = 40, a.add(1)));
attempt(() => [a.bump(), b.bump(), Counter.raise(a), Counter.raise(b)].join(" "));
attempt(() => { Counter.poke(b, { valueOf() { log.push("valueOf"); return 8; } }); return b.bump(); });
attempt(() => { Counter.poke(b, 9n); return b.bump(); });
attempt(() => { Counter.poke(b, Symbol("s")); return b.bump(); });
attempt(() => Counter.poke(b, 3));
for (const o of [a, b, {}, [], () => 1, Counter, Counter.prototype, Object.create(a), new Proxy(a, {}), 1, "s", null, undefined, Symbol.iterator, 1n]) {
  attempt(() => Counter.is(o));
  attempt(() => Counter.peek(o));
  attempt(() => Counter.poke(o, 7));
  attempt(() => Counter.twice(o));
  attempt(() => Counter.change(o, 11));
  attempt(() => Counter.raise(o));
}
attempt(() => Counter.again(a));
attempt(() => Counter.peek(a));
attempt(() => Counter.again(a));
attempt(() => Counter.brand(a));
var other = {}, frozen = Object.freeze({ x: 1 }), proxy = new Proxy({}, { defineProperty() { log.push("trap"); return false; }, has() { log.push("has"); return true; } });
for (const o of [other, frozen, proxy, 5, "t", null]) {
  attempt(() => Counter.again(o));
  attempt(() => Counter.again(o));
  attempt(() => Counter.peek(o));
  attempt(() => Counter.poke(o, "new"));
  attempt(() => Counter.peek(o));
  attempt(() => Counter.is(o));
  attempt(() => Counter.brand(o));
  attempt(() => Counter.is(o));
}
var kept_get = twice_get;
attempt(() => { twice_get = undefined; return Counter.twice(b); });
attempt(() => { twice_get = 5; return Counter.twice(b); });
attempt(() => { twice_get = { call(o) { return "called " + (o === b); } }; return Counter.twice(b); });
attempt(() => { twice_get = function () { return "own"; }; twice_get.call = function (o) { return "own call " + (o === b); }; return Counter.twice(b); });
attempt(() => { twice_get = kept_get; return Counter.twice(b); });
attempt(() => [Object.keys(a), Reflect.ownKeys(b), JSON.stringify(other), Object.getOwnPropertySymbols(other).length]);
for (let i = 0, sum = 0; i < 400; i++) { var c = new Counter(i & 3); sum += c.add(2) + c.double; if (i === 399) log.push(sum); }
console.log(log.join("\n"));
