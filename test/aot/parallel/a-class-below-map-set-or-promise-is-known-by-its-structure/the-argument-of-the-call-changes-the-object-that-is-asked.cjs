// The argument of this.get(..) lays an own get on the object, deletes it, and lays the object below another prototype: the callee was read before.
// COUNT: counter:BuiltinSubclassStructuresAccepted >= 1
// Under: --aot-testing=CheckProofsAtRunTime: where the name behind the look is gone the call may not count the receiver as a Map, and only this check sees it
"use strict";
class H extends Map { look(f) { return this.get(f(this)); } put(f) { return this.set(f(this), 1).size; } }
const one = new H(); one.set(1, 10); one.set(2, 20); let sum = 0, t = 0;
function key(m) { if (t === 100) m.get = () => 1000; if (t === 200) delete m.get; if (t === 250) Object.setPrototypeOf(m, Map.prototype); if (t === 300) Object.setPrototypeOf(m, H.prototype); return 1 + (t & 1); }
for (; t < 400; t++) { try { sum += H.prototype.look.call(one, key) + H.prototype.put.call(one, key); } catch (e) { sum += 7; } }
console.log(sum);
