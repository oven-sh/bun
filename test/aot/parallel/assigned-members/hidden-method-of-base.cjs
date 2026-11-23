// A method that a statement lays on the prototype of the class above is hidden by an unseen subclass.
class B { }
B.prototype.kind = function () { return "b"; };
class P extends B { constructor(t) { super(); this.text = t; } finish() { return this.kind(); } }
globalThis.extend = (C, p) => p(C); globalThis.call = o => o.finish();
const M = globalThis.extend(P, C => class extends C { kind() { return "m"; } });
console.log(globalThis.call(new M("a")), globalThis.call(Reflect.construct(P, ["a"], M)), globalThis.call(new P("b")), globalThis.call(new M("a")), new M("c").finish(), new P("d").finish());
