class L extends Array { constructor(...all) { super(...all); this.tag = all.length; } }
class E extends Error { constructor(m) { super(m); this.name = "E"; } }
class M extends Map {}
const l = Reflect.construct(L, [1, 2, 3]), e = Reflect.construct(E, ["boom"]), m = Reflect.construct(M, [[[1, 2]]]);
console.log(l.length, l.tag, Array.isArray(l), l instanceof L, "|", e.name, e.message, e instanceof E, "|", m.get(1), m instanceof M);
