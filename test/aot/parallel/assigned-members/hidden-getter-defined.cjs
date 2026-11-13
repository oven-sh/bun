// A getter that Object.defineProperty lays on a prototype is hidden by the getter of an unseen subclass.
class P { constructor(t) { this.text = t; this.pos = 0; } finish() { return this.value; } }
Object.defineProperty(P.prototype, "value", { get() { return "p"; }, configurable: true });
globalThis.extend = (C, p) => p(C); globalThis.call = o => o.finish();
const M = globalThis.extend(P, C => class extends C { get value() { return "m"; } });
console.log(globalThis.call(new M("a")), globalThis.call(Reflect.construct(P, ["a"], M)), globalThis.call(new P("b")), globalThis.call(new M("a")), new M("c").finish(), new P("d").finish());
