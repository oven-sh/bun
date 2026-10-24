// Class objects are created lazily: everything observable about them is right at the first inspection.
declare const console: any;
function D(o: any, k: any): string { const d: any = Object.getOwnPropertyDescriptor(o, k); return d ? (typeof d.value) + ":" + (typeof d.value === "object" || typeof d.value === "function" ? "" : String(d.value)) + " " + (d.writable ? "w" : "-") + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-") : "none"; }
function T(f: () => unknown): string { try { f(); return "no throw"; } catch (e: any) { return e.constructor.name; } }
function say(n: string, f: () => unknown): void { let r: string; try { r = JSON.stringify(f()) ?? "undefined"; } catch (e: any) { r = "throws " + e.constructor.name; } console.log(n + ": " + r); }
class A0 { x = 0; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("typeof", () => { const C: any = A0; return typeof C; });
class A1 { x = 1; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("absent", () => { const C: any = A1; return [C.displayName, C.$$typeof, C.then, C[Symbol.hasInstance] === Function.prototype[Symbol.hasInstance], 'nothing' in C, Object.hasOwn(C, 'nothing')]; });
class A2 { x = 2; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("absent, then prototype", () => { const C: any = A2; return [C.nothing, typeof C.prototype, C.prototype.constructor === C]; });
class A3 { x = 3; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("inherited", () => { const C: any = A3; return [C.call === Function.prototype.call, C.bind === Function.prototype.bind, typeof C.toString]; });
class A4 { x = 4; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("prototype", () => { const C: any = A4; return [typeof C.prototype, C.prototype === C.prototype, C.prototype.constructor === C, Object.getPrototypeOf(C.prototype) === Object.prototype]; });
class A5 { x = 5; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("descriptor of prototype", () => { const C: any = A5; return Object.getOwnPropertyDescriptor(C, 'prototype') && [D(C, 'prototype')]; });
class A6 { x = 6; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("descriptor of name", () => { const C: any = A6; return [D(C, 'name'), C.name]; });
class A7 { x = 7; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("descriptor of length", () => { const C: any = A7; return [D(C, 'length'), C.length]; });
class A8 { x = 8; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("has own", () => { const C: any = A8; return [Object.hasOwn(C, 'prototype'), Object.hasOwn(C, 'name'), Object.hasOwn(C, 'length'), 'prototype' in C, C.hasOwnProperty('prototype')]; });
class A9 { x = 9; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("names", () => { const C: any = A9; return Object.getOwnPropertyNames(C); });
class A10 { x = 10; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("own keys", () => { const C: any = A10; return Reflect.ownKeys(C).map(String); });
class A11 { x = 11; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("keys", () => { const C: any = A11; return [Object.keys(C), Object.entries(C), JSON.stringify({ ...C })]; });
class A12 { x = 12; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("for in", () => { const C: any = A12; return (() => { const seen = []; for (const k in C) seen.push(k); return seen; })(); });
class A13 { x = 13; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("store", () => { const C: any = A13; return (C.added = 1, [C.added, Object.keys(C), Object.getOwnPropertyNames(C)]); });
class A14 { x = 14; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("store, then prototype", () => { const C: any = A14; return (C.added = 1, [typeof C.prototype, C.prototype.constructor === C, D(C, 'prototype')]); });
class A15 { x = 15; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("store to prototype", () => { const C: any = A15; return T(() => { 'use strict'; C.prototype = {}; }); });
class A16 { x = 16; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("store to name", () => { const C: any = A16; return T(() => { 'use strict'; C.name = 'x'; }); });
class A17 { x = 17; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("define", () => { const C: any = A17; return (Object.defineProperty(C, 'defined', { value: 2, enumerable: true }), [C.defined, Object.keys(C), D(C, 'defined')]); });
class A18 { x = 18; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("define name", () => { const C: any = A18; return (Object.defineProperty(C, 'name', { value: 'Renamed' }), [C.name, D(C, 'name')]); });
class A19 { x = 19; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("define prototype", () => { const C: any = A19; return T(() => Object.defineProperty(C, 'prototype', { value: {} })); });
class A20 { x = 20; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("delete absent", () => { const C: any = A20; return [delete C.nothing, Object.getOwnPropertyNames(C)]; });
class A21 { x = 21; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("delete name", () => { const C: any = A21; return [delete C.name, Object.hasOwn(C, 'name'), C.name, Object.getOwnPropertyNames(C)]; });
class A22 { x = 22; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("delete prototype", () => { const C: any = A22; return T(() => { 'use strict'; delete C.prototype; }); });
class A23 { x = 23; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("index", () => { const C: any = A23; return (C[0] = 'zero', C[2] = 'two', [C[0], C[1], C[2], Object.keys(C), typeof C.prototype]); });
class A24 { x = 24; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("index, defined", () => { const C: any = A24; return (Object.defineProperty(C, 1, { value: 'one', enumerable: true }), [C[1], Object.keys(C)]); });
class A25 { x = 25; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("symbol", () => { const C: any = A25; return (C[Symbol.for('s')] = 3, [C[Symbol.for('s')], Reflect.ownKeys(C).map(String)]); });
class A26 { x = 26; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("extensible", () => { const C: any = A26; return [Object.isExtensible(C), Object.isFrozen(C), Object.isSealed(C)]; });
class A27 { x = 27; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("prevent extensions", () => { const C: any = A27; return (Object.preventExtensions(C), [Object.isExtensible(C), T(() => { 'use strict'; C.more = 1; }), typeof C.prototype, Object.getOwnPropertyNames(C)]); });
class A28 { x = 28; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("seal", () => { const C: any = A28; return (Object.seal(C), [Object.isSealed(C), Object.isFrozen(C), D(C, 'name'), D(C, 'prototype')]); });
class A29 { x = 29; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("freeze", () => { const C: any = A29; return (Object.freeze(C), [Object.isFrozen(C), D(C, 'name'), D(C, 'length'), D(C, 'prototype'), new C().m()]); });
class A30 { x = 30; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("prototype of", () => { const C: any = A30; return [Object.getPrototypeOf(C) === Function.prototype, C.__proto__ === Function.prototype, Function.prototype.isPrototypeOf(C)]; });
class A31 { x = 31; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("set prototype", () => { const C: any = A31; return (Object.setPrototypeOf(C, { inherited: 4 }), [C.inherited, typeof C.call, typeof C.prototype, new C().m()]); });
class A32 { x = 32; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("new", () => { const C: any = A32; return [new C().m(), new C() instanceof C, Object.getPrototypeOf(new C()) === C.prototype]; });
class A33 { x = 33; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("new, nothing else", () => { const C: any = A33; return new C().m(); });
class A34 { x = 34; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("construct", () => { const C: any = A34; return [(Reflect.construct(C, []) as any).m(), Reflect.construct(C, [], C) instanceof C]; });
class A35 { x = 35; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("construct with another target", () => { const C: any = A35; return (() => { function Other() {} const o = Reflect.construct(Object, [], C); return [o instanceof C, Object.getPrototypeOf(o) === C.prototype, typeof Other]; })(); });
class A36 { x = 36; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("instanceof", () => { const C: any = A36; return [{} instanceof C, Object.create(C.prototype) instanceof C]; });
class A37 { x = 37; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("instanceof first", () => { const C: any = A37; return ({}) instanceof C; });
class A38 { x = 38; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("call", () => { const C: any = A38; return T(() => C()); });
class A39 { x = 39; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("to string", () => { const C: any = A39; return [String(C).slice(0, 5), Object.prototype.toString.call(C)]; });
class A40 { x = 40; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("assign", () => { const C: any = A40; return (Object.assign(C, { a: 1, b: 2 }), [Object.keys(C), C.a + C.b]); });
class A41 { x = 41; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("assign from", () => { const C: any = A41; return Object.keys(Object.assign({}, C)); });
class A42 { x = 42; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("as a key", () => { const C: any = A42; return (() => { const m = new Map([[C, 1]]); const w = new WeakMap([[C, 2]]); return [m.get(C), w.get(C), new Set([C, C]).size]; })(); });
class A43 { x = 43; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("as a prototype", () => { const C: any = A43; return (() => { const o = Object.create(C); return [typeof o.prototype, o.name, Object.getPrototypeOf(o) === C, o.nothing]; })(); });
class A44 { x = 44; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("as a prototype, stored through", () => { const C: any = A44; return (() => { const o = Object.create(C); o.own = 1; return [Object.keys(o), Object.keys(C), T(() => { 'use strict'; o.name = 'x'; })]; })(); });
class A45 { x = 45; m(): number { return this.x; } second(a: number, b: number): number { return a + b; } }
say("members first", () => { const C: any = A45; return (() => { const o = new C(); return [o.constructor === C, o.constructor.name, Object.getOwnPropertyNames(Object.getPrototypeOf(o))]; })(); });
class Base { static made(): string { return "made by " + this.name; } static count = 7; b(): string { return "b"; } }
class Heir extends Base { h(): string { return "h"; } }
class Heir2 extends Base { static made(): string { return "heir2"; } }
class Leaf extends Heir { }
say("heirs: prototype of", () => { const B: any = Base, H: any = Heir, L: any = Leaf; return [Object.getPrototypeOf(L) === H, Object.getPrototypeOf(H) === B, Object.getPrototypeOf(B) === Function.prototype]; });
say("heirs: inherited static", () => { const H: any = Heir, H2: any = Heir2, L: any = Leaf; return [H.made(), H2.made(), L.made(), L.count, Object.hasOwn(L, "made"), Object.hasOwn(Base, "made")]; });
say("heirs: prototypes", () => { const H: any = Heir, L: any = Leaf; return [Object.getPrototypeOf(L.prototype) === H.prototype, Object.getPrototypeOf(H.prototype) === (Base as any).prototype, new L().b(), new L().h(), new L() instanceof Base]; });
say("heirs: names", () => [Object.getOwnPropertyNames(Base), Object.getOwnPropertyNames(Heir), Object.getOwnPropertyNames(Heir2), Object.getOwnPropertyNames(Leaf)]);
class Base3 { static s(): number { return 1; } }
class Heir3 extends Base3 { }
say("heirs: a store on the heir", () => { const H: any = Heir3; H.own = 1; return [Object.keys(H), Object.keys(Base3), H.s()]; });
class Base4 { }
class Heir4 extends Base4 { }
say("heirs: a store on the base is seen", () => { const B: any = Base4, H: any = Heir4; const before = H.late; B.late = 5; return [before, H.late, Object.hasOwn(H, "late")]; });
class Named { static name2 = "n"; static length2 = 3; }
say("static fields", () => { const C: any = Named; return [C.name2, C.length2, C.name, C.length, Object.keys(C)]; });
class WithName { static name(): string { return "a method"; } }
say("a static method called name", () => { const C: any = WithName; return [typeof C.name, C.name(), D(C, "name")]; });
const Anonymous: any = class { };
say("anonymous", () => [Anonymous.name, D(Anonymous, "name"), Object.getOwnPropertyNames(Anonymous)]);
say("anonymous, in place", () => { const C: any = (() => class { })(); return [C.name, Object.getOwnPropertyNames(C)]; });
export {};
