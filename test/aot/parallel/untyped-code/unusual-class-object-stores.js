// Unusual stores to class objects: index keys, `push.call`, `Object.assign`, `defineProperty`, `Reflect.set` and `Error.captureStackTrace`.
function row(name, f) { try { console.log(name + ": " + f()); } catch (e) { console.log(name + ": threw " + e.name); } }
class A0 {} row("an index stored", () => { A0[0] = "zero"; return [A0.name, A0[0], Object.getOwnPropertyNames(A0).join()].join(" "); });
class A1 {} row("push.call", () => { Array.prototype.push.call(A1, "pushed"); return [A1.name, A1[0], A1.length].join(" "); });
class A2 {} row("Object.assign with an index", () => { Object.assign(A2, { 0: "a", x: 1 }); return [A2.name, A2[0], A2.x].join(" "); });
class A3 {} row("defineProperty of an index", () => { Object.defineProperty(A3, 1, { value: "one", enumerable: true }); return [A3.name, A3[1]].join(" "); });
class A4 {} row("Reflect.set", () => { Reflect.set(A4, "x", 1); Reflect.set(A4, 2, "two"); return [A4.name, A4.x, A4[2]].join(" "); });
class A5 { static stack() { return "declared"; } } row("captureStackTrace over a declared static", () => { Error.captureStackTrace(A5); return [A5.name, typeof A5.stack, Object.getOwnPropertyNames(A5).filter(x => !x.startsWith("original")).join()].join(" "); });
class A6 {} row("captureStackTrace twice", () => { Error.captureStackTrace(A6); Error.captureStackTrace(A6); return [A6.name, typeof A6.stack].join(" "); });
class A7 {} row("captureStackTrace, then the descriptor", () => { Error.captureStackTrace(A7); const d = Object.getOwnPropertyDescriptor(A7, "stack"); return [Object.keys(d).sort().join(), d.enumerable, d.configurable, A7.name].join(" "); });
class A8 {} row("frozen behind the store", () => { Error.captureStackTrace(A8); Object.freeze(A8); return [Object.isFrozen(A8), A8.name, typeof A8.stack].join(" "); });
class A9 {} row("a symbol", () => { const s = Symbol("s"); A9[s] = 1; return [A9.name, A9[s], Object.getOwnPropertySymbols(A9).length].join(" "); });
class B0 {} row("the parent of the class object", () => { Object.setPrototypeOf(B0, { inherited: "yes" }); return [B0.name, B0.inherited].join(" "); });
class B1 {} row("__proto__ of the class object", () => { B1.__proto__ = { inherited: "yes" }; return [B1.name, B1.inherited].join(" "); });
class B2 {} row("the prototype's parent, then a subclass", () => { Object.setPrototypeOf(Object.getPrototypeOf(new B2()), { up: 1 }); class S extends B2 {} return [new S().up, S.name, B2.name, new S() instanceof B2].join(" "); });
class B3 { m() { return "m"; } } row("the prototype's parent null", () => { Object.setPrototypeOf(Object.getPrototypeOf(new B3()), null); return [B3.name, new B3().m(), Object.getPrototypeOf(B3.prototype)].join(" "); });
class B4base { b() { return "b"; } } class B4 extends B4base {} row("a derived class's prototype given another parent", () => { Object.setPrototypeOf(Object.getPrototypeOf(new B4()), { b() { return "other"; } }); return [B4.name, new B4().b(), Object.getPrototypeOf(B4) === B4base].join(" "); });
class B5 {} row("stamped, then used as a parent", () => { const Back = class { constructor(o) { return o; } }; class St extends Back { #p = 1; static has(o) { return #p in o; } } new St(B5); class S extends B5 {} return [St.has(B5), St.has(S), S.name, B5.name].join(" "); });
class B6 {} row("stamped twice is a TypeError", () => { const Back = class { constructor(o) { return o; } }; class St extends Back { #p = 1; } new St(B6); try { new St(B6); return "no throw"; } catch (e) { return e.name + " " + B6.name; } });
class B7 {} row("a WeakMap key, a Set member, then looked at", () => { const w = new WeakMap([[B7, 1]]), s = new Set([B7]); Error.captureStackTrace(B7); return [B7.name, w.get(B7), s.has(B7)].join(" "); });
