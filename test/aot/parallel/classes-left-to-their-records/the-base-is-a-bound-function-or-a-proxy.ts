class Base { x = 1; who(): string { return "base"; } static kind(): string { return "Base"; } }
const Bare = Base.bind(null) as unknown as typeof Base;
try { class BelowBare extends (Bare as typeof Base) {} console.log("made", BelowBare.name); } catch (e) { console.log("threw", (e as Error).constructor.name); }
const Bound = Base.bind(null) as unknown as typeof Base;
(Bound as { prototype: unknown }).prototype = Base.prototype;
class BelowBound extends (Bound as typeof Base) { own(): string { return this.who() + this.x; } }
let seen = 0;
const Wrapped = new Proxy(Base, { get(target, key, receiver) { seen++; return Reflect.get(target, key, receiver); } }) as typeof Base;
class BelowProxy extends (Wrapped as typeof Base) { own(): string { return this.who() + this.x; } }
console.log(new BelowBound().own(), Object.getPrototypeOf(BelowBound) === Bound, Object.getPrototypeOf(BelowBound) === Base, typeof (BelowBound as unknown as { kind?: unknown }).kind, new BelowBound() instanceof Base);
console.log(new BelowProxy().own(), seen > 0, Object.getPrototypeOf(BelowProxy) === Wrapped, Object.getPrototypeOf(BelowProxy) === Base, BelowProxy.kind(), seen > 1);
