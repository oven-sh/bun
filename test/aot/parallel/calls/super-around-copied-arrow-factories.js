// An arrow takes super from where it is written, also in the base and in the computed keys of a class in it.
const say = (...all) => console.log(...all);
const up = C => Object.getPrototypeOf(C).name, keys = C => Object.getOwnPropertyNames(C.prototype).join();
let derived;
class Upper { get Parent() { return Set; } get key() { return "upper"; } }
class Lower extends Upper { get Parent() { return Map; } init() { derived = F => class extends (super.Parent ?? F) { [super.key]() {} }; } }
new Lower().init();
const V = derived(Object), W = derived(Array);
say(up(V), up(W), keys(V), keys(W));
const kit = { __proto__: { Parent: Set, key: "below" }, Parent: Map, mix(F) { return class extends (super.Parent ?? F) { [super.key]() {} }; } };
const M = kit.mix(Object), N = kit.mix(Array);
say(up(M), up(N), keys(M), keys(N));
class Static extends Upper { static k = "static"; static { kit.keyed = F => class extends F { static [super.name] = 1; own() { return super.toString().length; } }; } }
const O = kit.keyed(Object), P = kit.keyed(Set);
say(Object.keys(O).join(), Object.keys(P).join(), new O().own(), new P().own());
