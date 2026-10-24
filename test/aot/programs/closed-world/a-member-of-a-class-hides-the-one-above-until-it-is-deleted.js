// A member of a class hides the member of the class above until somebody deletes it or moves the object.
const log = (...a) => console.log(a.map(String).join(" "));
const join = (...p) => p.join("");
class A1 { m() { return "A"; } } class B1 extends A1 { m() { return "B"; } } { const b = new B1(); log(1, b.m()); delete B1.prototype.m; log(1, b.m(), new B1().m()); }
class A2 { m() { return "A"; } } class B2 extends A2 { m() { return "B"; } } { const b = new B2(); Reflect.deleteProperty(B2.prototype, "m"); log(2, b.m()); }
class A3 { m() { return "A"; } } class B3 extends A3 { m() { return "B"; } } { const b = new B3(); delete B3.prototype[join("", "m")]; log(3, b.m()); }
class A4 { m() { return "A"; } } class B4 extends A4 { m() { return "B"; } } { const b = new B4(); delete new Proxy(B4.prototype, {}).m; log(4, b.m()); }
class A5 { m() { return "A"; } } class B5 extends A5 { m() { return "B"; } } { const b = new B5(); Object.setPrototypeOf(b, A5.prototype); log(5, b.m(), b instanceof B5); }
class A6 { m() { return "A"; } } class B6 extends A6 { m() { return "B"; } } { const b = new B6(); log(6, A6.prototype.m.call(b), Object.getPrototypeOf(B6.prototype).m.call(b), b.m()); }
class A7 { m() { return "A"; } } class B7 extends A7 { get m() { return () => "getter"; } } log(7, new B7().m(), new A7().m());
const Mix8 = Base => class extends Base { m() { return super.m() + "+"; } }; class A8 { m() { return "A"; } } class X8 { m() { return "X"; } } log(8, new (Mix8(A8))().m(), new (Mix8(X8))().m(), new (Mix8(Mix8(A8)))().m());
class A9 { m() { return "A"; } } class B9 extends A9 { m() { return "B"; } } { B9.prototype.m = undefined; try { log(9, new B9().m()); } catch (e) { log(9, e.constructor.name); } }
class A10 { } class B10 extends A10 { } { const b = new B10(); log(10, b.constructor === B10); delete B10.prototype.constructor; log(10, b.constructor === A10); delete A10.prototype.constructor; log(10, b.constructor === Object); }
class A11 { m() { return "A"; } } class B11 extends A11 { m() { return "B"; } } { const o = Object.create(B11.prototype); log(11, o.m()); const p = Object.create(A11.prototype); log(11, p.m()); const list = [o, p, new B11(), new A11()]; log(11, list.map(x => x.m()).join("")); }
const s12 = Symbol("s"); class A12 { [s12]() { return "A"; } 0() { return "A0"; } } class B12 extends A12 { [s12]() { return "B"; } 0() { return "B0"; } } { const b = new B12(); log(12, b[s12](), b[0]()); delete B12.prototype[s12]; delete B12.prototype[0]; log(12, b[s12](), b[0]()); }
class A13 { m() { return "A"; } } class B13 extends A13 { m() { return "B"; } } { Object.defineProperty(B13.prototype, "m", { get() { return A13.prototype.m; } }); log(13, new B13().m()); }
const k14 = join("", "m"); class A14 { m() { return "A"; } } class B14 extends A14 { [k14]() { return "B"; } } { const b = new B14(); log(14, b.m()); delete B14.prototype.m; log(14, b.m()); }
class A15 { m() { return "A"; } } class B15 extends A15 { m = () => "field"; } { const b = new B15(); log(15, b.m()); delete b.m; log(15, b.m()); }
class A16 { m() { return "A"; } } class B16 extends A16 { m() { return "B"; } } class C16 extends B16 { } { const c = new C16(); log(16, c.m()); Object.setPrototypeOf(C16.prototype, A16.prototype); log(16, c.m()); }
class A17 { get v() { return "A"; } set v(x) { this.got = "A" + x; } } class B17 extends A17 { get v() { return "B"; } } { const b = new B17(); try { b.v = 1; } catch (e) { log(17, e.constructor.name); } log(17, b.v, b.got); delete B17.prototype.v; b.v = 2; log(17, b.v, b.got); }
class A18 { m() { return "A"; } } class B18 extends A18 { m() { return "B"; } } { for (const k of Reflect.ownKeys(B18.prototype)) delete B18.prototype[k]; log(18, new B18().m(), new B18().constructor === A18); }
class A19 { static m() { return "A"; } } class B19 extends A19 { static m() { return "B"; } } { log(19, B19.m()); delete B19.m; log(19, B19.m()); }
class A20 { toString() { return "A"; } valueOf() { return 1; } } class B20 extends A20 { toString() { return "B"; } } { const b = new B20(); log(20, `${b}`, b + 1); delete B20.prototype.toString; log(20, `${b}`); delete A20.prototype.toString; log(20, `${b}`); }
function F21() { } F21.prototype.m = function () { return "F"; }; class B21 extends F21 { m() { return "B"; } } { const b = new B21(); log(21, b.m()); delete B21.prototype.m; log(21, b.m()); delete F21.prototype.m; log(21, typeof b.m); }
class A22 { m() { return "A"; } } class B22 extends A22 { m() { return "B"; } } { const text = '["m"]'; for (const k of JSON.parse(text)) delete B22.prototype[k]; log(22, new B22().m()); }
