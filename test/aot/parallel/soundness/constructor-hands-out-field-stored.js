// Ways in which a constructor hands `this` to other code before a field is stored. Each reader asks whether the field is there yet.
const out = [];
function show(name, ...v) { out.push(name + ": " + v.map(x => typeof x + " " + String(x)).join(", ")); }

// an extra argument read through `arguments`
let g1; function take1() { g1 = arguments[1]; } function read1() { const t = g1.x; return t === undefined ? "missing" : t + 1; }
class C1 { constructor() { take1(0, this); this.e = read1(); this.x = 1; } }
show("arguments", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new C1().e), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(read1()));

// a rest parameter
let g2; function take2(...r) { g2 = r[0]; } function read2() { const t = g2.x; return t === undefined ? "missing" : t + 1; }
class C2 { constructor() { take2(this); this.e = read2(); this.x = 1; } }
show("rest", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new C2().e), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(read2()));

// spread of an array that holds this
let g3; function take3(a) { g3 = a; } function read3() { const t = g3.x; return t === undefined ? "missing" : t + 1; }
class C3 { constructor() { take3(...[this]); this.e = read3(); this.x = 1; } }
show("spread", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new C3().e), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(read3()));

// Function.prototype.call, apply, Reflect.apply, bind
let g4; function take4() { g4 = this; } function read4() { const t = g4.x; return t === undefined ? "missing" : t + 1; }
class C4 { constructor() { take4.call(this); this.e = read4(); this.x = 1; } }
show("call", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new C4().e), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(read4()));
let g5; function take5(a) { g5 = a; } function read5() { const t = g5.x; return t === undefined ? "missing" : t + 1; }
class C5 { constructor() { take5.apply(null, [this]); this.e = read5(); this.x = 1; } }
show("apply", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new C5().e), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(read5()));
let g6; function take6(a) { g6 = a; } function read6() { const t = g6.x; return t === undefined ? "missing" : t + 1; }
class C6 { constructor() { Reflect.apply(take6, null, [this]); this.e = read6(); this.x = 1; } }
show("Reflect.apply", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new C6().e), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(read6()));
let g7; function take7(a, b) { g7 = b; } const bound7 = take7.bind(null, 0); function read7() { const t = g7.x; return t === undefined ? "missing" : t + 1; }
class C7 { constructor() { bound7(this); this.e = read7(); this.x = 1; } }
show("bound", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new C7().e), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(read7()));
let g8; function take8() { g8 = this; } function read8() { const t = g8.x; return t === undefined ? "missing" : t + 1; }
class C8 { constructor() { take8.bind(this)(); this.e = read8(); this.x = 1; } }
show("bind this", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new C8().e), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(read8()));

// thisArg of a built-in that calls back
let g9; function read9() { const t = g9.x; return t === undefined ? "missing" : t + 1; }
class C9 { constructor() { [0].forEach(function () { g9 = this; }, this); this.e = read9(); this.x = 1; } }
show("thisArg", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new C9().e), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(read9()));
let g10; function read10() { const t = g10.x; return t === undefined ? "missing" : t + 1; }
class C10 { constructor() { [this].forEach(o => { g10 = o; }); this.e = read10(); this.x = 1; } }
show("element", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new C10().e), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(read10()));

// another constructor takes it
let g11; class Other11 { constructor(o) { g11 = o; } } function read11() { const t = g11.x; return t === undefined ? "missing" : t + 1; }
class C11 { constructor() { new Other11(this); this.e = read11(); this.x = 1; } }
show("new", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new C11().e), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(read11()));

// a tagged template
let g12; function tag12(s, o) { g12 = o; } function read12() { const t = g12.x; return t === undefined ? "missing" : t + 1; }
class C12 { constructor() { tag12`${this}`; this.e = read12(); this.x = 1; } }
show("template", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new C12().e), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(read12()));

// a getter, a setter and a method of the prototype
class C13 { constructor() { this.e = this.early; this.x = 1; } get early() { const t = this.x; return t === undefined ? "missing" : t + 1; } }
show("getter", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new C13().e));
let g14; function read14() { const t = g14.x; return t === undefined ? "missing" : t + 1; }
class C14 { constructor() { this.v = 0; this.e = read14(); this.x = 1; } set v(_) { g14 = this; } }
show("setter", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new C14().e), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(read14()));
class C15 { constructor() { this.e = this.m(); this.x = 1; } m() { return this.n(); } n() { return this.o(); } o() { const t = this.x; return t === undefined ? "missing" : t + 1; } }
show("methods", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new C15().e));

// conversions
let g16; function read16() { const t = g16.x; return t === undefined ? "missing" : t + 1; }
class C16 { constructor() { `${this}`; this.e = read16(); this.x = 1; } toString() { g16 = this; return ""; } }
show("toString", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new C16().e), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(read16()));
let g17; function read17() { const t = g17.x; return t === undefined ? "missing" : t + 1; }
class C17 { constructor() { +this; this.e = read17(); this.x = 1; } valueOf() { g17 = this; return 0; } }
show("valueOf", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new C17().e), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(read17()));
let g18; function read18() { const t = g18.x; return t === undefined ? "missing" : t + 1; }
class C18 { constructor() { JSON.stringify(this); this.e = read18(); this.x = 1; } toJSON() { g18 = this; return 0; } }
show("toJSON", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new C18().e), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(read18()));
let g19; function read19() { const t = g19.x; return t === undefined ? "missing" : t + 1; }
class H19 { static [Symbol.hasInstance](o) { g19 = o; return false; } }
class C19 { constructor() { this instanceof H19; this.e = read19(); this.x = 1; } }
show("hasInstance", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new C19().e), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(read19()));

// containers
let g20 = new Map(); function read20() { const t = g20.get("k").x; return t === undefined ? "missing" : t + 1; }
class C20 { constructor() { g20.set("k", this); this.e = read20(); this.x = 1; } }
show("map", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new C20().e), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(read20()));
let g21 = []; function read21() { const t = g21[0].x; return t === undefined ? "missing" : t + 1; }
class C21 { constructor() { g21.push(this); this.e = read21(); this.x = 1; } }
show("push", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new C21().e), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(read21()));
let g22 = {}; function read22() { const t = g22.o.x; return t === undefined ? "missing" : t + 1; }
class C22 { constructor() { g22.o = this; this.e = read22(); this.x = 1; } }
show("property", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new C22().e), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(read22()));
let g23 = { box: { inner: null } }; function read23() { const t = g23.box.inner.o.x; return t === undefined ? "missing" : t + 1; }
class C23 { constructor() { const w = { o: this }; g23.box.inner = w; this.e = read23(); this.x = 1; } }
show("wrapped", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new C23().e), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(read23()));

// closures
let g24; function read24() { const t = g24().x; return t === undefined ? "missing" : t + 1; }
class C24 { constructor() { g24 = () => this; this.e = read24(); this.x = 1; } }
show("arrow", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new C24().e), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(read24()));
class C25 { constructor() { const f = () => this.x; this.e = f(); this.x = 1; } }
show("arrow called", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new C25().e));
class C26 { constructor() { const self = this; function f() { const t = self.x; return t === undefined ? "missing" : t + 1; } this.e = f(); this.x = 1; } }
show("self", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new C26().e));
class C27 { f = () => this.x; e = this.f(); x = 1; }
show("field arrow", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new C27().e));

console.log(out.join("\n"));
