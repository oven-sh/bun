// A method that a statement lays on a prototype is hidden after the class has instances.
class P { constructor(t) { this.text = t; this.pos = 0; } finish() { return this.kind(); } }
P.prototype.kind = function () { return "p"; };
globalThis.extend = (C, p) => p(C); globalThis.call = o => o.finish();
console.log(globalThis.call(new P("b")));
const M = globalThis.extend(P, C => class extends C { kind() { return "m"; } });
for (let i = 0; i < 3; i++) console.log(globalThis.call(new M("a")), globalThis.call(Reflect.construct(P, ["a"], M)), globalThis.call(new P("b")), globalThis.call(new M("a")), new M("c").finish(), new P("d").finish());
