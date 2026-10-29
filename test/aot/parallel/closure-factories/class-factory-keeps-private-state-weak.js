// A downleveled private field: the WeakMap is declared beside the function that returns the class, and code outside the class stores into it too.
var __classPrivateFieldGet = function (receiver, privateMap) { if (!privateMap.has(receiver)) { throw new TypeError("attempted to get private field on non-instance"); } return privateMap.get(receiver); };
const m = new WeakMap();
const make = () => class { constructor(v) { m.set(this, v); } read() { return __classPrivateFieldGet(this, m); } };
const C = make();
function f() { const o = new C(7); m.set(o, 9); return [o.read(), o.read()].join(); }
console.log(f());
