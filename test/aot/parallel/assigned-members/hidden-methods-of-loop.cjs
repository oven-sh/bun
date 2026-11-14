// Methods that a loop lays on a prototype are hidden by an unseen subclass, one of which calls super.
class P { constructor(t) { this.text = t; } finish() { return this.a() + this.b(); } }
for (const n of ["a", "b"]) P.prototype[n] = function () { return n; };
globalThis.extend = (C, p) => p(C); globalThis.call = o => o.finish();
const M = globalThis.extend(P, C => class extends C { a() { return "A"; } b() { return "B" + super.b(); } });
console.log(globalThis.call(new M("a")), globalThis.call(Reflect.construct(P, ["a"], M)), globalThis.call(new P("b")), globalThis.call(new M("a")), new M("c").finish(), new P("d").finish());
