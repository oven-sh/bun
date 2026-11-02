// A constructor hands `this` to a callee that collects it in a rest parameter, before a field is stored. Each reader asks whether the field is there yet.
const out = [];
const see = t => t === undefined ? "missing" : t + 1;
let k1; class O1 { constructor(...r) { k1 = r[0]; } } class C1 { constructor() { new O1(this); this.e = see(k1.x); this.x = 1; } } out.push("new: " + new C1().e + " " + see(k1.x));
let k2; function t2(...r) { k2 = r[0]; } class C2 { constructor() { t2.call(null, this); this.e = see(k2.x); this.x = 1; } } out.push("call: " + new C2().e + " " + see(k2.x));
let k3; function t3(...r) { k3 = r[0]; } class C3 { constructor() { t3.apply(null, [this]); this.e = see(k3.x); this.x = 1; } } out.push("apply: " + new C3().e + " " + see(k3.x));
let k4; function t4(...r) { k4 = r[0]; } class C4 { constructor() { Reflect.apply(t4, null, [this]); this.e = see(k4.x); this.x = 1; } } out.push("Reflect.apply: " + new C4().e + " " + see(k4.x));
let k5; function t5(...r) { k5 = r[1]; } const b5 = t5.bind(null, 0); class C5 { constructor() { b5(this); this.e = see(k5.x); this.x = 1; } } out.push("bound: " + new C5().e + " " + see(k5.x));
let k6; function t6(s, ...r) { k6 = r[0]; } class C6 { constructor() { t6`${this}`; this.e = see(k6.x); this.x = 1; } } out.push("template: " + new C6().e + " " + see(k6.x));
let k7; const t7 = (...r) => { k7 = r[0]; }; class C7 { constructor() { t7(this); this.e = see(k7.x); this.x = 1; } } out.push("arrow: " + new C7().e + " " + see(k7.x));
let k8; class H8 { static take(...r) { k8 = r[0]; } } class C8 { constructor() { H8.take(this); this.e = see(k8.x); this.x = 1; } } out.push("static method: " + new C8().e + " " + see(k8.x));
let k9; class A9 { constructor(...r) { k9 = this; this.e = see(k9.x); } } class C9 extends A9 { constructor() { super(1, 2); this.x = 1; } } out.push("super: " + new C9().e + " " + see(k9.x));
let k10; function t10(...r) { k10 = r[0]; } class C10 { x; constructor() { t10(this); this.e = k10.x === undefined ? "undefined" : k10.x; this.x = 1; } } out.push("declared field: " + new C10().e + " " + k10.x);
let k11; function t11(...[a]) { k11 = a; } class C11 { constructor() { t11(this); this.e = see(k11.x); this.x = 1; } } out.push("a pattern: " + new C11().e + " " + see(k11.x));
let k12; async function t12(...r) { k12 = r[0]; } class C12 { constructor() { t12(this); this.e = see(k12.x); this.x = 1; } } out.push("async: " + new C12().e + " " + see(k12.x));
let k13; function* t13(...r) { k13 = r[0]; } class C13 { constructor() { t13(this).next(); this.e = see(k13.x); this.x = 1; } } out.push("generator: " + new C13().e + " " + see(k13.x));
console.log(out.join("\n"));
