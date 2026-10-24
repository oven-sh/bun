// Objects inside objects: repo binds calls builtin and untyped subclass objects untyped. It prints what plain Bun prints.
function D(o, k) { const d = Object.getOwnPropertyDescriptor(o, k); return d ? (typeof d.value) + ":" + (typeof d.value === "object" || typeof d.value === "function" ? "" : String(d.value)) + " " + (d.writable ? "w" : "-") + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-") : "none"; }
function T(f) { try { f(); return "no throw"; } catch (e) { return e.constructor.name; } }
function say(n, f) { let r; try { r = JSON.stringify(f()); if (r === undefined) r = "undefined"; } catch (e) { r = "throws " + e.constructor.name; } console.log(n + ": " + r); }
class U { static inherited() { return "from U"; } u() { return "u"; } }
function F() { } F.inherited = function () { return "from F"; }; F.prototype.f = function () { return "f"; };
class A0 extends Error { m() { return 0; } static own() { return "own 0"; } }
say("Error: absent", () => { const C = A0, PARENT = Error; return [C.displayName, C.$$typeof, 'nothing' in C, Object.hasOwn(C, 'nothing')]; });
class A1 extends Error { m() { return 1; } static own() { return "own 1"; } }
say("Error: prototype of", () => { const C = A1, PARENT = Error; return [Object.getPrototypeOf(C) === PARENT, C.__proto__ === PARENT]; });
class A2 extends Error { m() { return 2; } static own() { return "own 2"; } }
say("Error: prototype", () => { const C = A2, PARENT = Error; return [typeof C.prototype, C.prototype.constructor === C, Object.getPrototypeOf(C.prototype) === PARENT.prototype]; });
class A3 extends Error { m() { return 3; } static own() { return "own 3"; } }
say("Error: descriptors", () => { const C = A3, PARENT = Error; return [D(C, 'prototype'), D(C, 'name'), D(C, 'length')]; });
class A4 extends Error { m() { return 4; } static own() { return "own 4"; } }
say("Error: names", () => { const C = A4, PARENT = Error; return Object.getOwnPropertyNames(C); });
class A5 extends Error { m() { return 5; } static own() { return "own 5"; } }
say("Error: keys", () => { const C = A5, PARENT = Error; return [Object.keys(C), Reflect.ownKeys(C).map(String)]; });
class A6 extends Error { m() { return 6; } static own() { return "own 6"; } }
say("Error: store", () => { const C = A6, PARENT = Error; return (C.added = 1, [C.added, Object.keys(C), Object.getOwnPropertyNames(C), Object.hasOwn(PARENT, 'added')]); });
class A7 extends Error { m() { return 7; } static own() { return "own 7"; } }
say("Error: define", () => { const C = A7, PARENT = Error; return (Object.defineProperty(C, 'd', { value: 2, enumerable: true }), [C.d, Object.keys(C)]); });
class A8 extends Error { m() { return 8; } static own() { return "own 8"; } }
say("Error: delete name", () => { const C = A8, PARENT = Error; return [delete C.name, Object.hasOwn(C, 'name'), typeof C.name]; });
class A9 extends Error { m() { return 9; } static own() { return "own 9"; } }
say("Error: index", () => { const C = A9, PARENT = Error; return (C[0] = 'zero', [C[0], Object.keys(C)]); });
class A10 extends Error { m() { return 10; } static own() { return "own 10"; } }
say("Error: freeze", () => { const C = A10, PARENT = Error; return (Object.freeze(C), [Object.isFrozen(C), D(C, 'prototype'), T(() => { 'use strict'; C.x = 1; })]); });
class A11 extends Error { m() { return 11; } static own() { return "own 11"; } }
say("Error: prevent extensions", () => { const C = A11, PARENT = Error; return (Object.preventExtensions(C), [Object.isExtensible(C), Object.getOwnPropertyNames(C)]); });
class A12 extends Error { m() { return 12; } static own() { return "own 12"; } }
say("Error: own static", () => { const C = A12, PARENT = Error; return [C.own(), Object.hasOwn(C, 'own'), D(C, 'own')]; });
class A13 extends Error { m() { return 13; } static own() { return "own 13"; } }
say("Error: new", () => { const C = A13, PARENT = Error; return (() => { const o = new C(); return [o instanceof C, o instanceof PARENT, Object.getPrototypeOf(o) === C.prototype, o.m()]; })(); });
class A14 extends Error { m() { return 14; } static own() { return "own 14"; } }
say("Error: new, nothing else", () => { const C = A14, PARENT = Error; return new C().m(); });
class A15 extends Error { m() { return 15; } static own() { return "own 15"; } }
say("Error: as a prototype", () => { const C = A15, PARENT = Error; return (() => { const o = Object.create(C); return [typeof o.prototype, o.name, Object.getPrototypeOf(o) === C]; })(); });
class A16 extends Error { m() { return 16; } static own() { return "own 16"; } }
say("Error: members first", () => { const C = A16, PARENT = Error; return (() => { const o = new C(); return [o.constructor === C, o.constructor.name, Object.getOwnPropertyNames(Object.getPrototypeOf(o))]; })(); });
class A17 extends Error { m() { return 17; } static own() { return "own 17"; } }
say("Error: extended again", () => { const C = A17, PARENT = Error; return (() => { class Again extends C { } return [Object.getPrototypeOf(Again) === C, new Again() instanceof C, new Again().m(), Again.own()]; })(); });
class A18 extends Array { m() { return 18; } static own() { return "own 18"; } }
say("Array: absent", () => { const C = A18, PARENT = Array; return [C.displayName, C.$$typeof, 'nothing' in C, Object.hasOwn(C, 'nothing')]; });
class A19 extends Array { m() { return 19; } static own() { return "own 19"; } }
say("Array: prototype of", () => { const C = A19, PARENT = Array; return [Object.getPrototypeOf(C) === PARENT, C.__proto__ === PARENT]; });
class A20 extends Array { m() { return 20; } static own() { return "own 20"; } }
say("Array: prototype", () => { const C = A20, PARENT = Array; return [typeof C.prototype, C.prototype.constructor === C, Object.getPrototypeOf(C.prototype) === PARENT.prototype]; });
class A21 extends Array { m() { return 21; } static own() { return "own 21"; } }
say("Array: descriptors", () => { const C = A21, PARENT = Array; return [D(C, 'prototype'), D(C, 'name'), D(C, 'length')]; });
class A22 extends Array { m() { return 22; } static own() { return "own 22"; } }
say("Array: names", () => { const C = A22, PARENT = Array; return Object.getOwnPropertyNames(C); });
class A23 extends Array { m() { return 23; } static own() { return "own 23"; } }
say("Array: keys", () => { const C = A23, PARENT = Array; return [Object.keys(C), Reflect.ownKeys(C).map(String)]; });
class A24 extends Array { m() { return 24; } static own() { return "own 24"; } }
say("Array: store", () => { const C = A24, PARENT = Array; return (C.added = 1, [C.added, Object.keys(C), Object.getOwnPropertyNames(C), Object.hasOwn(PARENT, 'added')]); });
class A25 extends Array { m() { return 25; } static own() { return "own 25"; } }
say("Array: define", () => { const C = A25, PARENT = Array; return (Object.defineProperty(C, 'd', { value: 2, enumerable: true }), [C.d, Object.keys(C)]); });
class A26 extends Array { m() { return 26; } static own() { return "own 26"; } }
say("Array: delete name", () => { const C = A26, PARENT = Array; return [delete C.name, Object.hasOwn(C, 'name'), typeof C.name]; });
class A27 extends Array { m() { return 27; } static own() { return "own 27"; } }
say("Array: index", () => { const C = A27, PARENT = Array; return (C[0] = 'zero', [C[0], Object.keys(C)]); });
class A28 extends Array { m() { return 28; } static own() { return "own 28"; } }
say("Array: freeze", () => { const C = A28, PARENT = Array; return (Object.freeze(C), [Object.isFrozen(C), D(C, 'prototype'), T(() => { 'use strict'; C.x = 1; })]); });
class A29 extends Array { m() { return 29; } static own() { return "own 29"; } }
say("Array: prevent extensions", () => { const C = A29, PARENT = Array; return (Object.preventExtensions(C), [Object.isExtensible(C), Object.getOwnPropertyNames(C)]); });
class A30 extends Array { m() { return 30; } static own() { return "own 30"; } }
say("Array: own static", () => { const C = A30, PARENT = Array; return [C.own(), Object.hasOwn(C, 'own'), D(C, 'own')]; });
class A31 extends Array { m() { return 31; } static own() { return "own 31"; } }
say("Array: new", () => { const C = A31, PARENT = Array; return (() => { const o = new C(); return [o instanceof C, o instanceof PARENT, Object.getPrototypeOf(o) === C.prototype, o.m()]; })(); });
class A32 extends Array { m() { return 32; } static own() { return "own 32"; } }
say("Array: new, nothing else", () => { const C = A32, PARENT = Array; return new C().m(); });
class A33 extends Array { m() { return 33; } static own() { return "own 33"; } }
say("Array: as a prototype", () => { const C = A33, PARENT = Array; return (() => { const o = Object.create(C); return [typeof o.prototype, o.name, Object.getPrototypeOf(o) === C]; })(); });
class A34 extends Array { m() { return 34; } static own() { return "own 34"; } }
say("Array: members first", () => { const C = A34, PARENT = Array; return (() => { const o = new C(); return [o.constructor === C, o.constructor.name, Object.getOwnPropertyNames(Object.getPrototypeOf(o))]; })(); });
class A35 extends Array { m() { return 35; } static own() { return "own 35"; } }
say("Array: extended again", () => { const C = A35, PARENT = Array; return (() => { class Again extends C { } return [Object.getPrototypeOf(Again) === C, new Again() instanceof C, new Again().m(), Again.own()]; })(); });
class A36 extends Map { m() { return 36; } static own() { return "own 36"; } }
say("Map: absent", () => { const C = A36, PARENT = Map; return [C.displayName, C.$$typeof, 'nothing' in C, Object.hasOwn(C, 'nothing')]; });
class A37 extends Map { m() { return 37; } static own() { return "own 37"; } }
say("Map: prototype of", () => { const C = A37, PARENT = Map; return [Object.getPrototypeOf(C) === PARENT, C.__proto__ === PARENT]; });
class A38 extends Map { m() { return 38; } static own() { return "own 38"; } }
say("Map: prototype", () => { const C = A38, PARENT = Map; return [typeof C.prototype, C.prototype.constructor === C, Object.getPrototypeOf(C.prototype) === PARENT.prototype]; });
class A39 extends Map { m() { return 39; } static own() { return "own 39"; } }
say("Map: descriptors", () => { const C = A39, PARENT = Map; return [D(C, 'prototype'), D(C, 'name'), D(C, 'length')]; });
class A40 extends Map { m() { return 40; } static own() { return "own 40"; } }
say("Map: names", () => { const C = A40, PARENT = Map; return Object.getOwnPropertyNames(C); });
class A41 extends Map { m() { return 41; } static own() { return "own 41"; } }
say("Map: keys", () => { const C = A41, PARENT = Map; return [Object.keys(C), Reflect.ownKeys(C).map(String)]; });
class A42 extends Map { m() { return 42; } static own() { return "own 42"; } }
say("Map: store", () => { const C = A42, PARENT = Map; return (C.added = 1, [C.added, Object.keys(C), Object.getOwnPropertyNames(C), Object.hasOwn(PARENT, 'added')]); });
class A43 extends Map { m() { return 43; } static own() { return "own 43"; } }
say("Map: define", () => { const C = A43, PARENT = Map; return (Object.defineProperty(C, 'd', { value: 2, enumerable: true }), [C.d, Object.keys(C)]); });
class A44 extends Map { m() { return 44; } static own() { return "own 44"; } }
say("Map: delete name", () => { const C = A44, PARENT = Map; return [delete C.name, Object.hasOwn(C, 'name'), typeof C.name]; });
class A45 extends Map { m() { return 45; } static own() { return "own 45"; } }
say("Map: index", () => { const C = A45, PARENT = Map; return (C[0] = 'zero', [C[0], Object.keys(C)]); });
class A46 extends Map { m() { return 46; } static own() { return "own 46"; } }
say("Map: freeze", () => { const C = A46, PARENT = Map; return (Object.freeze(C), [Object.isFrozen(C), D(C, 'prototype'), T(() => { 'use strict'; C.x = 1; })]); });
class A47 extends Map { m() { return 47; } static own() { return "own 47"; } }
say("Map: prevent extensions", () => { const C = A47, PARENT = Map; return (Object.preventExtensions(C), [Object.isExtensible(C), Object.getOwnPropertyNames(C)]); });
class A48 extends Map { m() { return 48; } static own() { return "own 48"; } }
say("Map: own static", () => { const C = A48, PARENT = Map; return [C.own(), Object.hasOwn(C, 'own'), D(C, 'own')]; });
class A49 extends Map { m() { return 49; } static own() { return "own 49"; } }
say("Map: new", () => { const C = A49, PARENT = Map; return (() => { const o = new C(); return [o instanceof C, o instanceof PARENT, Object.getPrototypeOf(o) === C.prototype, o.m()]; })(); });
class A50 extends Map { m() { return 50; } static own() { return "own 50"; } }
say("Map: new, nothing else", () => { const C = A50, PARENT = Map; return new C().m(); });
class A51 extends Map { m() { return 51; } static own() { return "own 51"; } }
say("Map: as a prototype", () => { const C = A51, PARENT = Map; return (() => { const o = Object.create(C); return [typeof o.prototype, o.name, Object.getPrototypeOf(o) === C]; })(); });
class A52 extends Map { m() { return 52; } static own() { return "own 52"; } }
say("Map: members first", () => { const C = A52, PARENT = Map; return (() => { const o = new C(); return [o.constructor === C, o.constructor.name, Object.getOwnPropertyNames(Object.getPrototypeOf(o))]; })(); });
class A53 extends Map { m() { return 53; } static own() { return "own 53"; } }
say("Map: extended again", () => { const C = A53, PARENT = Map; return (() => { class Again extends C { } return [Object.getPrototypeOf(Again) === C, new Again() instanceof C, new Again().m(), Again.own()]; })(); });
class A54 extends U { m() { return 54; } static own() { return "own 54"; } }
say("an untyped class: absent", () => { const C = A54, PARENT = U; return [C.displayName, C.$$typeof, 'nothing' in C, Object.hasOwn(C, 'nothing')]; });
class A55 extends U { m() { return 55; } static own() { return "own 55"; } }
say("an untyped class: prototype of", () => { const C = A55, PARENT = U; return [Object.getPrototypeOf(C) === PARENT, C.__proto__ === PARENT]; });
class A56 extends U { m() { return 56; } static own() { return "own 56"; } }
say("an untyped class: prototype", () => { const C = A56, PARENT = U; return [typeof C.prototype, C.prototype.constructor === C, Object.getPrototypeOf(C.prototype) === PARENT.prototype]; });
class A57 extends U { m() { return 57; } static own() { return "own 57"; } }
say("an untyped class: descriptors", () => { const C = A57, PARENT = U; return [D(C, 'prototype'), D(C, 'name'), D(C, 'length')]; });
class A58 extends U { m() { return 58; } static own() { return "own 58"; } }
say("an untyped class: names", () => { const C = A58, PARENT = U; return Object.getOwnPropertyNames(C); });
class A59 extends U { m() { return 59; } static own() { return "own 59"; } }
say("an untyped class: keys", () => { const C = A59, PARENT = U; return [Object.keys(C), Reflect.ownKeys(C).map(String)]; });
class A60 extends U { m() { return 60; } static own() { return "own 60"; } }
say("an untyped class: store", () => { const C = A60, PARENT = U; return (C.added = 1, [C.added, Object.keys(C), Object.getOwnPropertyNames(C), Object.hasOwn(PARENT, 'added')]); });
class A61 extends U { m() { return 61; } static own() { return "own 61"; } }
say("an untyped class: define", () => { const C = A61, PARENT = U; return (Object.defineProperty(C, 'd', { value: 2, enumerable: true }), [C.d, Object.keys(C)]); });
class A62 extends U { m() { return 62; } static own() { return "own 62"; } }
say("an untyped class: delete name", () => { const C = A62, PARENT = U; return [delete C.name, Object.hasOwn(C, 'name'), typeof C.name]; });
class A63 extends U { m() { return 63; } static own() { return "own 63"; } }
say("an untyped class: index", () => { const C = A63, PARENT = U; return (C[0] = 'zero', [C[0], Object.keys(C)]); });
class A64 extends U { m() { return 64; } static own() { return "own 64"; } }
say("an untyped class: freeze", () => { const C = A64, PARENT = U; return (Object.freeze(C), [Object.isFrozen(C), D(C, 'prototype'), T(() => { 'use strict'; C.x = 1; })]); });
class A65 extends U { m() { return 65; } static own() { return "own 65"; } }
say("an untyped class: prevent extensions", () => { const C = A65, PARENT = U; return (Object.preventExtensions(C), [Object.isExtensible(C), Object.getOwnPropertyNames(C)]); });
class A66 extends U { m() { return 66; } static own() { return "own 66"; } }
say("an untyped class: own static", () => { const C = A66, PARENT = U; return [C.own(), Object.hasOwn(C, 'own'), D(C, 'own')]; });
class A67 extends U { m() { return 67; } static own() { return "own 67"; } }
say("an untyped class: new", () => { const C = A67, PARENT = U; return (() => { const o = new C(); return [o instanceof C, o instanceof PARENT, Object.getPrototypeOf(o) === C.prototype, o.m()]; })(); });
class A68 extends U { m() { return 68; } static own() { return "own 68"; } }
say("an untyped class: new, nothing else", () => { const C = A68, PARENT = U; return new C().m(); });
class A69 extends U { m() { return 69; } static own() { return "own 69"; } }
say("an untyped class: as a prototype", () => { const C = A69, PARENT = U; return (() => { const o = Object.create(C); return [typeof o.prototype, o.name, Object.getPrototypeOf(o) === C]; })(); });
class A70 extends U { m() { return 70; } static own() { return "own 70"; } }
say("an untyped class: members first", () => { const C = A70, PARENT = U; return (() => { const o = new C(); return [o.constructor === C, o.constructor.name, Object.getOwnPropertyNames(Object.getPrototypeOf(o))]; })(); });
class A71 extends U { m() { return 71; } static own() { return "own 71"; } }
say("an untyped class: extended again", () => { const C = A71, PARENT = U; return (() => { class Again extends C { } return [Object.getPrototypeOf(Again) === C, new Again() instanceof C, new Again().m(), Again.own()]; })(); });
class A72 extends F { m() { return 72; } static own() { return "own 72"; } }
say("a plain function: absent", () => { const C = A72, PARENT = F; return [C.displayName, C.$$typeof, 'nothing' in C, Object.hasOwn(C, 'nothing')]; });
class A73 extends F { m() { return 73; } static own() { return "own 73"; } }
say("a plain function: prototype of", () => { const C = A73, PARENT = F; return [Object.getPrototypeOf(C) === PARENT, C.__proto__ === PARENT]; });
class A74 extends F { m() { return 74; } static own() { return "own 74"; } }
say("a plain function: prototype", () => { const C = A74, PARENT = F; return [typeof C.prototype, C.prototype.constructor === C, Object.getPrototypeOf(C.prototype) === PARENT.prototype]; });
class A75 extends F { m() { return 75; } static own() { return "own 75"; } }
say("a plain function: descriptors", () => { const C = A75, PARENT = F; return [D(C, 'prototype'), D(C, 'name'), D(C, 'length')]; });
class A76 extends F { m() { return 76; } static own() { return "own 76"; } }
say("a plain function: names", () => { const C = A76, PARENT = F; return Object.getOwnPropertyNames(C); });
class A77 extends F { m() { return 77; } static own() { return "own 77"; } }
say("a plain function: keys", () => { const C = A77, PARENT = F; return [Object.keys(C), Reflect.ownKeys(C).map(String)]; });
class A78 extends F { m() { return 78; } static own() { return "own 78"; } }
say("a plain function: store", () => { const C = A78, PARENT = F; return (C.added = 1, [C.added, Object.keys(C), Object.getOwnPropertyNames(C), Object.hasOwn(PARENT, 'added')]); });
class A79 extends F { m() { return 79; } static own() { return "own 79"; } }
say("a plain function: define", () => { const C = A79, PARENT = F; return (Object.defineProperty(C, 'd', { value: 2, enumerable: true }), [C.d, Object.keys(C)]); });
class A80 extends F { m() { return 80; } static own() { return "own 80"; } }
say("a plain function: delete name", () => { const C = A80, PARENT = F; return [delete C.name, Object.hasOwn(C, 'name'), typeof C.name]; });
class A81 extends F { m() { return 81; } static own() { return "own 81"; } }
say("a plain function: index", () => { const C = A81, PARENT = F; return (C[0] = 'zero', [C[0], Object.keys(C)]); });
class A82 extends F { m() { return 82; } static own() { return "own 82"; } }
say("a plain function: freeze", () => { const C = A82, PARENT = F; return (Object.freeze(C), [Object.isFrozen(C), D(C, 'prototype'), T(() => { 'use strict'; C.x = 1; })]); });
class A83 extends F { m() { return 83; } static own() { return "own 83"; } }
say("a plain function: prevent extensions", () => { const C = A83, PARENT = F; return (Object.preventExtensions(C), [Object.isExtensible(C), Object.getOwnPropertyNames(C)]); });
class A84 extends F { m() { return 84; } static own() { return "own 84"; } }
say("a plain function: own static", () => { const C = A84, PARENT = F; return [C.own(), Object.hasOwn(C, 'own'), D(C, 'own')]; });
class A85 extends F { m() { return 85; } static own() { return "own 85"; } }
say("a plain function: new", () => { const C = A85, PARENT = F; return (() => { const o = new C(); return [o instanceof C, o instanceof PARENT, Object.getPrototypeOf(o) === C.prototype, o.m()]; })(); });
class A86 extends F { m() { return 86; } static own() { return "own 86"; } }
say("a plain function: new, nothing else", () => { const C = A86, PARENT = F; return new C().m(); });
class A87 extends F { m() { return 87; } static own() { return "own 87"; } }
say("a plain function: as a prototype", () => { const C = A87, PARENT = F; return (() => { const o = Object.create(C); return [typeof o.prototype, o.name, Object.getPrototypeOf(o) === C]; })(); });
class A88 extends F { m() { return 88; } static own() { return "own 88"; } }
say("a plain function: members first", () => { const C = A88, PARENT = F; return (() => { const o = new C(); return [o.constructor === C, o.constructor.name, Object.getOwnPropertyNames(Object.getPrototypeOf(o))]; })(); });
class A89 extends F { m() { return 89; } static own() { return "own 89"; } }
say("a plain function: extended again", () => { const C = A89, PARENT = F; return (() => { class Again extends C { } return [Object.getPrototypeOf(Again) === C, new Again() instanceof C, new Again().m(), Again.own()]; })(); });
// What the declaration reads, and when.
const seen = [];
function watched(name, target) { return new Proxy(target, { get(t, k, r) { seen.push(name + "." + String(k)); return Reflect.get(t, k, r); }, getPrototypeOf(t) { seen.push(name + ".[[GetPrototypeOf]]"); return Reflect.getPrototypeOf(t); } }); }
say("a proxy is extended: what is read at the declaration", () => { const P = watched("P", class { p() { return "p"; } }); class OverProxy extends P { m() { return 1; } } const atDeclaration = seen.splice(0); const o = new OverProxy(); const atNew = seen.splice(0); return [atDeclaration, atNew, o.p(), o.m(), Object.getPrototypeOf(OverProxy) === P]; });
say("a getter for prototype", () => { function G() { } let reads = 0; const B = G.bind(null); Object.defineProperty(B, "prototype", { get() { reads++; return G.prototype; } }); class OverGetter extends B { } const atDeclaration = reads; new OverGetter(); return [atDeclaration, Object.getPrototypeOf(OverGetter) === B, Object.getPrototypeOf(OverGetter.prototype) === G.prototype]; });
say("a bound function is extended", () => { const B = U.bind(null); B.prototype = U.prototype; class OverBound extends B { } return [Object.getPrototypeOf(OverBound) === B, new OverBound().u(), new OverBound() instanceof U]; });
say("what is extended is no constructor", () => [T(() => { class X extends 5 { } }), T(() => { class X extends (() => 1) { } }), T(() => { class X extends ({}) { } }), T(() => { class X extends undefined { } })]);
say("its prototype is no object", () => { function G() { } G.prototype = 5; return T(() => { class X extends G { } }); });
say("its prototype is null", () => { function G() { } G.prototype = null; class X extends G { m() { return 1; } } return [Object.getPrototypeOf(X.prototype), Object.getPrototypeOf(X) === G]; });
say("extends null", () => { class X extends null { static s() { return 1; } } return [Object.getPrototypeOf(X) === Function.prototype, Object.getPrototypeOf(X.prototype), X.s(), Object.getOwnPropertyNames(X)]; });
// The parent changes after the declaration.
class ParentA { static who() { return "A"; } } class ParentB { static who() { return "B"; } }
class Child extends ParentA { }
say("inherited statics follow the parent", () => { const before = Child.who(); Object.setPrototypeOf(Child, ParentB); const after = Child.who(); ParentB.late = 1; return [before, after, Child.late, Object.getOwnPropertyNames(Child)]; });
class ParentC { } class Child2 extends ParentC { } class Child3 extends ParentC { }
say("two heirs of one parent are apart", () => { Child2.mine = 2; return [Child2.mine, Child3.mine, Object.keys(Child2), Object.keys(Child3), Object.keys(ParentC)]; });
say("a store on the parent is seen by both", () => { ParentC.shared = 3; return [Child2.shared, Child3.shared, Object.hasOwn(Child3, "shared")]; });
say("a setter on the parent", () => { let got; class PS { static set v(x) { got = [x, this === HS]; } } class HS extends PS { } HS.v = 9; return [got, Object.keys(HS)]; });
say("a read-only property on the parent", () => { class PR { } Object.defineProperty(PR, "ro", { value: 1, writable: false }); class HR extends PR { } return [T(() => { "use strict"; HR.ro = 2; }), HR.ro, Object.hasOwn(HR, "ro")]; });
// Static members in their order, with fields and blocks.
say("static members in order", () => { const order = []; class S extends U { static a = order.push("a"); static m() { return 1; } static { order.push("block " + Object.getOwnPropertyNames(S).join(",")); } static b = order.push("b"); } return [order, Object.getOwnPropertyNames(S)]; });
