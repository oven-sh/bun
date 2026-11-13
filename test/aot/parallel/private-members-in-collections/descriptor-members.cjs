// STATISTIC: KnownHelperCalls >= 20
// Private members as Babel 7.14 to 7.23 and SWC write them: descriptors in WeakMaps.
function _classPrivateMethodInitSpec(obj, privateSet) { _checkPrivateRedeclaration(obj, privateSet); privateSet.add(obj); }
function _classPrivateFieldInitSpec(obj, privateMap, value) { _checkPrivateRedeclaration(obj, privateMap); privateMap.set(obj, value); }
function _checkPrivateRedeclaration(obj, privateCollection) { if (privateCollection.has(obj)) { throw new TypeError("Cannot initialize the same private elements twice on an object"); } }
function _classPrivateMethodGet(receiver, privateSet, fn) { if (!privateSet.has(receiver)) { throw new TypeError("attempted to get private field on non-instance"); } return fn; }
function _classPrivateFieldGet(receiver, privateMap) { var descriptor = _classExtractFieldDescriptor(receiver, privateMap, "get"); return _classApplyDescriptorGet(receiver, descriptor); }
function _classApplyDescriptorGet(receiver, descriptor) { if (descriptor.get) { return descriptor.get.call(receiver); } return descriptor.value; }
function _classPrivateFieldSet(receiver, privateMap, value) { var descriptor = _classExtractFieldDescriptor(receiver, privateMap, "set"); _classApplyDescriptorSet(receiver, descriptor, value); return value; }
function _classExtractFieldDescriptor(receiver, privateMap, action) { if (!privateMap.has(receiver)) { throw new TypeError("attempted to " + action + " private field on non-instance"); } return privateMap.get(receiver); }
function _classApplyDescriptorSet(receiver, descriptor, value) { if (descriptor.set) { descriptor.set.call(receiver, value); } else { if (!descriptor.writable) { throw new TypeError("attempted to set read only private field"); } descriptor.value = value; } }
var log = [];
function attempt(f) { try { log.push(String(f())); } catch (e) { log.push(e.name + ": " + e.message); } }
var _total = /*#__PURE__*/new WeakMap();
var _fixed = /*#__PURE__*/new WeakMap();
var _double = /*#__PURE__*/new WeakMap();
var _once = /*#__PURE__*/new WeakSet();
class Counter {
  constructor(step) {
    _classPrivateMethodInitSpec(this, _once);
    _classPrivateFieldInitSpec(this, _double, { get: _get_double, set: _set_double });
    _classPrivateFieldInitSpec(this, _total, { writable: true, value: 0 });
    _classPrivateFieldInitSpec(this, _fixed, { writable: false, value: step });
    if (step === "fix") _classPrivateFieldSet(this, _fixed, 1);
  }
  add(times) { for (let i = 0; i < times; i++) _classPrivateMethodGet(this, _once, _once2).call(this); return _classPrivateFieldGet(this, _total); }
  get twice() { return _classPrivateFieldGet(this, _double); }
  set twice(v) { _classPrivateFieldSet(this, _double, v); }
  bump() { var _this$total, _this$total2; return _classPrivateFieldSet(this, _total, (_this$total = _classPrivateFieldGet(this, _total), _this$total2 = _this$total++, _this$total)), _this$total2; }
  static peek(o) { return _classPrivateFieldGet(o, _total); }
  static poke(o, v) { return _classPrivateFieldSet(o, _total, v); }
  static fixed(o) { return _classPrivateFieldGet(o, _fixed); }
  static fix(o) { return _classPrivateFieldSet(o, _fixed, 1); }
  static again(o, d) { _classPrivateFieldInitSpec(o, _total, d); return "added"; }
  static is(o) { return _once.has(o) && _total.has(o); }
}
function _once2() { _classPrivateFieldSet(this, _total, _classPrivateFieldGet(this, _total) + _classPrivateFieldGet(this, _fixed)); }
function _get_double() { return _classPrivateFieldGet(this, _total) * 2; }
function _set_double(v) { _classPrivateFieldSet(this, _total, v / 2); }
class Below extends Counter { constructor() { super(5); this.own = 1; } }
var a = new Counter(2), b = new Below();
attempt(() => a.add(3));
attempt(() => b.add(2));
attempt(() => a.twice);
attempt(() => (a.twice = 40, a.add(1)));
attempt(() => [a.bump(), a.bump(), Counter.peek(a)]);
attempt(() => Counter.fix(a));
attempt(() => new Counter("fix"));
for (const o of [a, b, {}, [], () => 1, Counter, Counter.prototype, Object.create(a), new Proxy(a, {}), 1, "s", null, undefined, Symbol.iterator]) {
  attempt(() => Counter.is(o));
  attempt(() => Counter.peek(o));
  attempt(() => Counter.poke(o, 7));
  attempt(() => Counter.fixed(o));
}
attempt(() => Counter.again(a, { writable: true, value: 1 }));
attempt(() => Counter.peek(a));
for (const d of [{ writable: true, value: 3 }, { get() { return "got " + (this === other); } }, { value: 4 }, 5, null, undefined, "text"]) {
  var other = {};
  attempt(() => Counter.again(other, d));
  attempt(() => Counter.again(other, d));
  attempt(() => Counter.peek(other));
  attempt(() => Counter.poke(other, "new"));
  attempt(() => Counter.peek(other));
}
attempt(() => Reflect.ownKeys(b).join());
for (let i = 0, sum = 0; i < 400; i++) { var c = new Counter(i & 3); sum += c.add(2) + c.twice; if (i === 399) log.push(sum); }
console.log(log.join("\n"));
