// A downleveled private field: the WeakMap is declared beside the function that returns the class, and a subclass instance reads its entry.
var __classPrivateFieldGet = function (receiver, privateMap) { if (!privateMap.has(receiver)) { throw new TypeError("attempted to get private field on non-instance"); } return privateMap.get(receiver); };
const m = new WeakMap();
const make = () => class { constructor(v) { m.set(this, v); } read() { return __classPrivateFieldGet(this, m); } };
class S extends make() {}
console.log(new S(7).read());
