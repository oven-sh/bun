// The method of an unseen subclass that hides an assigned one is deleted and laid again.
class P { constructor(t) { this.text = t; this.pos = 0; } finish() { return this.kind(); } }
P.prototype.kind = function () { return "p"; };
globalThis.extend = (C, p) => p(C); globalThis.call = o => o.finish();
const M = globalThis.extend(P, C => class extends C { kind() { return "m"; } });
const o = new M("x"); console.log(globalThis.call(o)); delete M.prototype.kind; console.log(globalThis.call(o)); M.prototype.kind = () => "again"; console.log(globalThis.call(o));
console.log(globalThis.call(new M("a")), globalThis.call(Reflect.construct(P, ["a"], M)), globalThis.call(new P("b")), globalThis.call(new M("a")), new M("c").finish(), new P("d").finish());
