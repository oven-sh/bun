// A statement lays a method on a prototype after an unseen subclass has a method of that name.
class P { constructor(t) { this.text = t; this.pos = 0; } finish() { return this.kind(); } }
globalThis.extend = (C, p) => p(C); globalThis.call = o => o.finish();
const M = globalThis.extend(P, C => class extends C { kind() { return "m"; } });
console.log(globalThis.call(new M("a")));
P.prototype.kind = function () { return "later"; };
console.log(globalThis.call(new M("a")), globalThis.call(Reflect.construct(P, ["a"], M)), globalThis.call(new P("b")), globalThis.call(new M("a")), new M("c").finish(), new P("d").finish());
