// What an instance answers under the name constructor: where the class keeps the property it was created with, and where somebody replaces, hides or deletes it.
const log = (...a) => console.log(a.map(String).join(" "));
class P1 { } log(1, new P1().constructor === P1, new P1().constructor.name, new (new P1().constructor)() instanceof P1);
class A2 { who() { return this.constructor.name; } make() { return new this.constructor(); } } class B2 extends A2 { } log(2, new A2().who(), new B2().who(), new B2().make() instanceof B2, new A2().make() instanceof B2, new B2().constructor === B2, Object.getPrototypeOf(new B2().constructor) === A2);
class C3 { } const c3 = new C3(); log(3, c3.constructor === C3); C3.prototype.constructor = Object; log(3, c3.constructor === Object);
class C4 { } const c4 = new C4(); c4.constructor = "own"; log(4, c4.constructor, new C4().constructor === C4);
class C5 { constructor() { this.constructor = 5; } } log(5, new C5().constructor);
class C6 { } const c6 = new C6(); Object.setPrototypeOf(c6, { constructor: "moved" }); log(6, c6.constructor); const n6 = new C6(); Object.setPrototypeOf(n6, null); log(6, n6.constructor);
class C7 { } delete C7.prototype.constructor; log(7, new C7().constructor === Object);
function mk8() { return class K { }; } const K8a = mk8(), K8b = mk8(); log(8, new K8a().constructor === K8a, new K8b().constructor === K8b, new K8a().constructor === K8b);
function mk9(v) { return class K { get() { return v; } }; } const K9a = mk9(1), K9b = mk9(2); log(9, new (new K9a().constructor)().get(), new (new K9b().constructor)().get());
class C10 { static s = 10; static make() { return new this(); } } log(10, new C10().constructor.s, C10.make().constructor === C10, C10.prototype.constructor === C10, Object.create(C10.prototype).constructor === C10, Reflect.construct(Object, [], C10).constructor === C10);

class C12 { static constructor() { return "static"; } } log(12, new C12().constructor === C12, C12.constructor());
class C13 { ["constructor"]() { return "computed"; } } log(13, typeof new C13().constructor, new C13().constructor === C13, new C13().constructor());
function F14() { } log(14, new F14().constructor === F14); F14.prototype = { x: 1 }; log(14, new F14().constructor === Object);
class C15 { } const k15 = ["const", "ructor"].join(""); C15.prototype[k15] = Array; log(15, new C15().constructor === Array);
class C16 { } Object.defineProperty(C16.prototype, "constructor", { get() { return Map; } }); log(16, new C16().constructor === Map);
class C17 { } const any17 = [new C17(), {}, [], 1, "s", () => 1]; log(17, any17.map(v => v.constructor.name).join());
class C18 extends Array { } log(18, new C18().constructor === C18, new C18(1, 2).map(x => x).constructor === C18, [].constructor === Array);
class C19 { } class D19 extends C19 { } Object.setPrototypeOf(D19.prototype, { constructor: "cut" }); delete D19.prototype.constructor; log(19, new D19().constructor);
class C20 { eq(o) { return o.constructor === this.constructor; } } class D20 extends C20 { } log(20, new C20().eq(new C20()), new C20().eq(new D20()), new D20().eq(new D20()), new C20().eq({}), new C20().eq(Object.create(null)));
