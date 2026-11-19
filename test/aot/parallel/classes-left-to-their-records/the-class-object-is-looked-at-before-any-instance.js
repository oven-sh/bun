class Above { static count = 3; static list() { return Object.keys(this); } m() {} }
class Below extends Above { static own = 4; n() {} }
console.log(Below.count, Below.own, Below.list().join(), Object.keys(Below).join(), "count" in Below, Object.hasOwn(Below, "count"), Reflect.ownKeys(Below).map(String).join(), Reflect.ownKeys(Below.prototype).map(String).join());
Above.count = 9;
console.log(Below.count);
Below.count = 1;
console.log(Above.count, Below.count, Object.isExtensible(Below), Object.isFrozen(Below));
Object.freeze(Below);
console.log(Object.isFrozen(Below), (() => { "use strict"; try { Below.z = 1; return "stored"; } catch (e) { return e.constructor.name; } })());
