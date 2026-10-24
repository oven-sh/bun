// What undoes a claim about a constructor, a variable or a static field is reached only through a function that a table holds under "undefined", and the key is undefined only because it is read before its store.
const out = [];
function show(name, v) { out.push(name + ": " + typeof v + " " + String(v)); }
function attempt(f) { try { return f(); } catch (e) { return e.constructor.name; } }

// an object of the subclass that the constructor of the subclass never sees
class B1 { constructor() { this.b = 1; } } class D1 extends B1 { constructor() { super(); this.d = 2; } }
function rd1(o) { const t = o.d; return t === undefined ? "missing" : t + 1; }
function key1() { return k1; } const T1 = { a: () => new D1(), undefined: () => Reflect.construct(B1, [], D1) };
show("construct with another new.target", rd1(T1[key1()]())); var k1 = "a"; show("construct, after", rd1(T1[key1()]()));

// the class object reaches unknown code while a static field is not defined yet
function key2() { return k2; } const seen2 = []; const T2 = { a(c) { }, undefined(c) { seen2.push(Object.getOwnPropertyNames(c).includes("late")); Reflect.ownKeys(c); JSON.stringify(c); } };
class S2 { static first = T2[key2()](S2); static late = 1; } var k2 = "a";
show("class object handed out early", seen2.join() + "," + (S2.late + 1));

// a function that is entered late has a captured variable of its own that is read early
function key3() { return k3; } const T3 = { a: () => "early", undefined: () => { const g = () => { const t = x; return t === undefined ? "missing" : t + 1; }; const r = g(); var x = 1; return r + "," + g(); } };
show("captured variable of a late function", T3[key3()]()); var k3 = "a";
function key4() { return k4; } const T4 = { a: () => "early", undefined: () => { const g = () => x + 1; const r = attempt(g); let x = 1; return r + "," + g(); } };
show("captured let of a late function", T4[key4()]()); var k4 = "a";

// the callee that takes `this` is a bound function, a built-in, or unknown
let kept5; function keep5(o) { kept5 = o; } function key5() { return k5; } const T5 = { a(o) { }, undefined: keep5.bind(null) };
function peek5() { const t = kept5.x; return t === undefined ? "missing" : t + 1; }
class C5 { constructor() { T5[key5()](this); this.e = kept5 ? peek5() : "none"; this.x = 1; } }
show("late bound function", new C5().e); var k5 = "a"; show("late bound function, after", new C5().e);
const set6 = new Set(); function key6() { return k6; } const T6 = { a(o) { }, undefined: set6.add.bind(set6) };
function peek6() { for (const o of set6) { const t = o.x; return t === undefined ? "missing" : t + 1; } return "none"; }
class C6 { constructor() { T6[key6()](this); this.e = peek6(); this.x = 1; } }
show("late built-in", new C6().e); var k6 = "a";
function key7() { return k7; } const T7 = { a(o) { }, undefined: Object.freeze }; let e7;
class C7 { constructor() { T7[key7()](this); e7 = attempt(() => { this.x = 1; return "stored"; }); } }
{ const o = new C7(); show("late freeze", e7 + "," + (o.x === undefined ? "missing" : o.x + 1)); } var k7 = "a"; { const o = new C7(); show("late freeze, after", e7 + "," + (o.x + 1)); }
globalThis.keep8 = function (o) { globalThis.kept8 = o; }; function key8() { return k8; } const T8 = { a(o) { }, get undefined() { return globalThis.keep8; } };
function peek8() { const t = globalThis.kept8.x; return t === undefined ? "missing" : t + 1; }
class C8 { constructor() { T8[key8()](this); this.e = globalThis.kept8 ? peek8() : "none"; this.x = 1; } }
show("late unknown callee", new C8().e); var k8 = "a";

// three levels: each claim falls only after the one before it fell
let s9a, s9b; function key9() { return k9; }
class In9 { constructor() { s9b = this; this.r = T9b[s9b.k](); this.k = "a"; } }
const T9b = { a: () => "early", undefined: () => { const t = v9; return t === undefined ? "missing" : t + 1; } };
class Out9 { constructor() { s9a = this; this.r = T9a[s9a.k](); this.k = "a"; } }
const T9a = { a: () => "early", undefined: () => new In9().r };
const T9 = { a: () => "early", undefined: () => new Out9().r };
show("three levels", T9[key9()]()); var k9 = "a"; var v9 = 1; show("three levels, after", T9[key9()]() + "," + new Out9().r + "," + new In9().r);

// a second store that is reached late
let w10 = 1; function key10() { return k10; } const T10 = { a() { }, undefined() { w10 = "two"; } }; function r10() { return w10 + 1; }
T10[key10()](); var k10 = "a"; show("late second store", r10());
class S11 { static n = 1; } function key11() { return k11; } const T11 = { a() { }, undefined() { S11.n = "two"; } }; function r11() { return S11.n + 1; }
T11[key11()](); var k11 = "a"; show("late second store of a static field", r11());
class C12 { constructor() { this.n = 1; } } const o12 = new C12(); function key12() { return k12; } const T12 = { a() { }, undefined() { o12.n = "two"; } }; function r12() { return o12.n + 1; }
T12[key12()](); var k12 = "a"; show("late second store of a field", r12());

console.log(out.join("\n"));
