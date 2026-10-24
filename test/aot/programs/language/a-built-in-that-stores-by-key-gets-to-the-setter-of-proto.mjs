// A built-in that stores by key gets to the native setter of __proto__ where that is the key: the prototype changes, and what is read afterwards comes from the new one.
function viaReflect() { const p = { inherited: 7 }, o = { own: 1 }; Reflect.set(o, "__proto__", p); return [o.inherited, Object.getPrototypeOf(o) === p, "inherited" in o, Object.keys(o).join()].join(); }
function viaComputed(key) { const p = { inherited: 7 }, o = { own: 1 }; Reflect.set(o, key, p); return [o.inherited, Object.getPrototypeOf(o) === p].join(); }
function viaAssign() { const p = { inherited: 7 }, o = { own: 1 }; Object.assign(o, { ["__proto__"]: p }); return [o.inherited, Object.getPrototypeOf(o) === p].join(); }
function viaReceiver() { const p = { inherited: 7 }, o = { own: 1 }, r = { other: 2 }; Reflect.set(o, "__proto__", p, r); return [o.inherited, r.inherited, Object.getPrototypeOf(r) === p].join(); }
function viaClass() { class A { m() { return "a"; } } class B { m() { return "b"; } } const o = new A(); Reflect.set(o, "__proto__", B.prototype); return [o.m(), o instanceof B, o instanceof A].join(); }
function viaNull() { const o = { own: 1 }; Reflect.set(o, "__proto__", null); return [typeof o.toString, Object.getPrototypeOf(o)].join(); }
function viaSetter() { const p = { inherited: 7 }, o = { own: 1 }; Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(o, p); return [o.inherited].join(); }
console.log(viaReflect(), "|", viaComputed("__pro" + "to__"), "|", viaAssign(), "|", viaReceiver(), "|", viaClass(), "|", viaNull(), "|", viaSetter());
