// A field that nothing reads is still observed: by a store that a frozen object refuses, by delete, by the tests of integrity, by redefinition, and by every way to read that is no plain read.
const rows = [];
function say(label, f) {
  try {
    rows.push(label + ": " + f());
  } catch (e) {
    rows.push(label + ": threw " + e.name);
  }
}
say("store to a frozen own field", () => { const o = Object.freeze({ a1: 1 }); o.a1 = 2; return "stored"; });
say("store to a field frozen later", () => { const o = { a2: 1 }; o.a2 = 2; Object.freeze(o); o.a2 = 3; return "stored"; });
say("delete of a frozen field", () => { const o = Object.freeze({ a3: 1 }); return delete o.a3; });
say("delete of a sealed field", () => { const o = Object.seal({ a4: 1 }); return delete o.a4; });
say("isFrozen of a closed object", () => Object.isFrozen(Object.preventExtensions({ a5: 1 })));
say("isSealed of a closed object", () => Object.isSealed(Object.preventExtensions({ a6: 1 })));
say("isFrozen of a sealed object", () => Object.isFrozen(Object.seal({ a7: 1 })));
say("redefine on a sealed object", () => { const o = Object.seal({ a8: 1 }); Object.defineProperty(o, "a8", { value: 2 }); return "defined"; });
say("redefine on a frozen object", () => { const o = Object.freeze({ a9: 1 }); Object.defineProperty(o, "a9", { value: 2 }); return "defined"; });
say("same value on a frozen object", () => { const o = Object.freeze({ b1: 1 }); Object.defineProperty(o, "b1", { value: 1 }); return "defined"; });
say("store on a closed object", () => { const o = Object.preventExtensions({ b2: 1 }); o.b2 = 2; o.b3 = 3; return "stored"; });
say("class field frozen in the constructor", () => { class C { c1 = 1; constructor() { Object.freeze(this); } } const c = new C(); c.c1 = 2; return "stored"; });
say("field stored after freeze in the constructor", () => { class C { constructor() { Object.freeze(this); this.c2 = 1; } } new C(); return "made"; });
say("through a proxy", () => new Proxy({ d1: "read" }, {}).d1);
say("Reflect.get", () => Reflect.get({ d2: "read" }, "d2"));
say("Reflect.has", () => Reflect.has({ d3: 1 }, "d3"));
say("descriptor", () => Object.getOwnPropertyDescriptor({ d4: "read" }, "d4").value);
say("descriptors", () => Object.keys(Object.getOwnPropertyDescriptors({ d5: 1, d6: 2 })).join());
say("names", () => Object.getOwnPropertyNames({ d7: 1 }).length);
say("rest", () => { const { d8, ...rest } = { d8: 1, d9: 2 }; return Object.keys(rest).join(); });
say("super", () => ({ __proto__: { e1: "inherited" }, m() { return super.e1; } }).m());
say("Reflect.set through an heir", () => { const base = Object.freeze({ e2: 1 }); return Reflect.set(Object.create(base), "e2", 2); });
say("Reflect.set with a receiver", () => { const target = Object.freeze({ e3: 1 }); const receiver = {}; return Reflect.set(target, "e3", 2, receiver) + " " + Object.keys(receiver).join(); });
say("assign into a frozen target", () => { Object.assign(Object.freeze({ e4: 1 }), { e4: 2 }); return "assigned"; });
say("assign through an heir", () => Object.keys(Object.assign(Object.create(Object.freeze({ e5: 1 })), { e5: 2 })).join());
say("increment of a frozen field", () => { const o = Object.freeze({ e6: 1 }); o.e6++; return "incremented"; });
say("logical assignment", () => { const o = Object.freeze({ e7: 0 }); o.e7 ||= 5; return "assigned"; });
say("destructuring into a frozen field", () => { const o = Object.freeze({ e8: 0 }); [o.e8] = [1]; return "assigned"; });
say("for-in target", () => { const o = Object.freeze({ e9: 0 }); for (o.e9 in { k: 1 }); return "assigned"; });
say("array element of a frozen holder", () => { const o = Object.freeze({ list: [1] }); o.list = []; return "stored"; });
say("frozen through a helper", () => { const deep = x => Object.freeze(x); const o = deep({ f1: 1 }); o.f1 = 2; return "stored"; });
say("frozen in a loop", () => { const all = [{ f2: 1 }, { f2: 2 }]; for (const each of all) Object.freeze(each); all[1].f2 = 3; return "stored"; });
say("frozen by Object.values", () => { const holder = { inner: { f3: 1 } }; Object.values(holder).forEach(Object.freeze); holder.inner.f3 = 2; return "stored"; });
console.log(rows.join("\n"));
