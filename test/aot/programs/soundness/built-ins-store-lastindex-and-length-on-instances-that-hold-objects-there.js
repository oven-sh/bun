// Built-ins that store, define or delete by a name of their own on whatever object they are given.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const seen = [];
class R { lastIndex = { qa: 1 }; flags = "g"; global = true; exec() { return null; } }
function li(r) { return attempt(() => r.lastIndex.qa); }
const r1 = new R(); RegExp.prototype[Symbol.replace].call(r1, "abc", "x"); console.log(li(r1), typeof r1.lastIndex);
const r2 = new R(); RegExp.prototype[Symbol.match].call(r2, "abc"); console.log(li(r2), typeof r2.lastIndex);
const r3 = new R(); RegExp.prototype[Symbol.search].call(r3, "abc"); console.log(li(r3), typeof r3.lastIndex);
const r4 = new R(); "abc".replace({ [Symbol.replace]: (s, v) => RegExp.prototype[Symbol.replace].call(r4, s, v) }, "x"); console.log(li(r4), typeof r4.lastIndex);
console.log(li(new R()));
class L { length = { qa: 1 }; }
function le(o) { return attempt(() => o.length.qa); }
const l1 = new L(); Array.prototype.push.call(l1, 5); console.log(le(l1), typeof l1.length);
const l2 = new L(); Array.prototype.pop.call(l2); console.log(le(l2), typeof l2.length);
const l3 = new L(); Array.prototype.shift.call(l3); console.log(le(l3), typeof l3.length);
const l4 = new L(); Array.prototype.unshift.call(l4, 1); console.log(le(l4), typeof l4.length);
const l5 = new L(); Array.prototype.splice.call(l5, 0, 0); console.log(le(l5), typeof l5.length);
console.log(le(new L()));
