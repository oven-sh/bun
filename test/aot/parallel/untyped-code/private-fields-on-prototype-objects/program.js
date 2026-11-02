const Back = class { constructor(o) { return o; } };
class One extends Back { #p = "one"; static has(o) { return #p in o; } static read(o) { return o.#p; } }
class Twelve extends Back { #a = 1; #b = 2; #c = 3; #d = 4; #e = 5; #f = 6; #g = 7; #h = 8; #i = 9; #j = 10; #k = 11; #l = { held: "an object" }; static has(o) { return #a in o && #l in o; } static read(o) { return o.#a + o.#b + o.#c + o.#d + o.#e + o.#f + o.#g + o.#h + o.#i + o.#j + o.#k + o.#l.held; } }
class Brand extends Back { #m() { return "method"; } get #g() { return "getter"; } static has(o) { return #m in o; } static read(o) { return o.#m() + o.#g; } }
let junk = []; function garbage(k) { for (let i = 0; i < 40; i++) junk.push({ a: i, b: [i, k], c: "s" + i }); if (junk.length > 2000) junk = []; }
let sum = ""; function note(s) { sum += s + ";"; }
const names = o => Object.getOwnPropertyNames(o).filter(x => !x.startsWith("original")).join("/");
class C0 {  }
new One(C0.prototype); garbage(0);
{ const C = C0, P = C.prototype; note(String(names(P))); garbage(0); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C1 { m() { return 1; } }
new Twelve(C1.prototype); garbage(1);
{ const C = C1, P = C.prototype; note(String(names(P))); garbage(1); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C2 { m() { return 1; } get g() { return 3; } set g(v) {} }
new Brand(C2.prototype); garbage(2);
{ const C = C2, P = C.prototype; note(String(names(P))); garbage(2); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C3 { stack() { return "declared"; } m() {} }
Error.captureStackTrace(C3.prototype); garbage(3);
{ const C = C3, P = C.prototype; note(String(names(P))); garbage(3); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C4 { a() {} b() {} c() {} d() {} m() {} }
new One(C4.prototype); new Twelve(C4.prototype); new Brand(C4.prototype); Error.captureStackTrace(C4.prototype); garbage(4);
{ const C = C4, P = C.prototype; note(String(names(P))); garbage(4); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C5 {  }
new Twelve(C5.prototype); new One(C5); garbage(5);
{ const C = C5, P = C.prototype; note(String(names(P))); garbage(5); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C6 { m() { return 6; } }
 garbage(6);
{ const C = C6, P = C.prototype; note(String(names(P))); garbage(6); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C7 { m() { return 1; } get g() { return 3; } set g(v) {} }
new One(C7.prototype); garbage(7);
{ const C = C7, P = C.prototype; note(String(typeof P.m)); garbage(7); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C8 { stack() { return "declared"; } m() {} }
new Twelve(C8.prototype); garbage(8);
{ const C = C8, P = C.prototype; note(String(typeof P.m)); garbage(8); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C9 { a() {} b() {} c() {} d() {} m() {} }
new Brand(C9.prototype); garbage(9);
{ const C = C9, P = C.prototype; note(String(typeof P.m)); garbage(9); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C10 {  }
Error.captureStackTrace(C10.prototype); garbage(10);
{ const C = C10, P = C.prototype; note(String(typeof P.m)); garbage(10); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C11 { m() { return 11; } }
new One(C11.prototype); new Twelve(C11.prototype); new Brand(C11.prototype); Error.captureStackTrace(C11.prototype); garbage(11);
{ const C = C11, P = C.prototype; note(String(typeof P.m)); garbage(11); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C12 { m() { return 1; } get g() { return 3; } set g(v) {} }
new Twelve(C12.prototype); new One(C12); garbage(12);
{ const C = C12, P = C.prototype; note(String(typeof P.m)); garbage(12); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C13 { stack() { return "declared"; } m() {} }
 garbage(13);
{ const C = C13, P = C.prototype; note(String(typeof P.m)); garbage(13); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C14 { a() {} b() {} c() {} d() {} m() {} }
new One(C14.prototype); garbage(14);
{ const C = C14, P = C.prototype; note(String("m" in P)); garbage(14); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C15 {  }
new Twelve(C15.prototype); garbage(15);
{ const C = C15, P = C.prototype; note(String("m" in P)); garbage(15); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C16 { m() { return 16; } }
new Brand(C16.prototype); garbage(16);
{ const C = C16, P = C.prototype; note(String("m" in P)); garbage(16); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C17 { m() { return 1; } get g() { return 3; } set g(v) {} }
Error.captureStackTrace(C17.prototype); garbage(17);
{ const C = C17, P = C.prototype; note(String("m" in P)); garbage(17); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C18 { stack() { return "declared"; } m() {} }
new One(C18.prototype); new Twelve(C18.prototype); new Brand(C18.prototype); Error.captureStackTrace(C18.prototype); garbage(18);
{ const C = C18, P = C.prototype; note(String("m" in P)); garbage(18); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C19 { a() {} b() {} c() {} d() {} m() {} }
new Twelve(C19.prototype); new One(C19); garbage(19);
{ const C = C19, P = C.prototype; note(String("m" in P)); garbage(19); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
console.log("19 " + sum.length + " " + sum.slice(-150)); sum = "";
class C20 {  }
 garbage(20);
{ const C = C20, P = C.prototype; note(String("m" in P)); garbage(20); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C21 { m() { return 21; } }
new One(C21.prototype); garbage(21);
{ const C = C21, P = C.prototype; note(String(Object.keys(P).length)); garbage(21); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C22 { m() { return 1; } get g() { return 3; } set g(v) {} }
new Twelve(C22.prototype); garbage(22);
{ const C = C22, P = C.prototype; note(String(Object.keys(P).length)); garbage(22); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C23 { stack() { return "declared"; } m() {} }
new Brand(C23.prototype); garbage(23);
{ const C = C23, P = C.prototype; note(String(Object.keys(P).length)); garbage(23); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C24 { a() {} b() {} c() {} d() {} m() {} }
Error.captureStackTrace(C24.prototype); garbage(24);
{ const C = C24, P = C.prototype; note(String(Object.keys(P).length)); garbage(24); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C25 {  }
new One(C25.prototype); new Twelve(C25.prototype); new Brand(C25.prototype); Error.captureStackTrace(C25.prototype); garbage(25);
{ const C = C25, P = C.prototype; note(String(Object.keys(P).length)); garbage(25); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C26 { m() { return 26; } }
new Twelve(C26.prototype); new One(C26); garbage(26);
{ const C = C26, P = C.prototype; note(String(Object.keys(P).length)); garbage(26); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C27 { m() { return 1; } get g() { return 3; } set g(v) {} }
 garbage(27);
{ const C = C27, P = C.prototype; note(String(Object.keys(P).length)); garbage(27); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C28 { stack() { return "declared"; } m() {} }
new One(C28.prototype); garbage(28);
{ const C = C28, P = C.prototype; note(String(P.constructor === C)); garbage(28); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C29 { a() {} b() {} c() {} d() {} m() {} }
new Twelve(C29.prototype); garbage(29);
{ const C = C29, P = C.prototype; note(String(P.constructor === C)); garbage(29); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C30 {  }
new Brand(C30.prototype); garbage(30);
{ const C = C30, P = C.prototype; note(String(P.constructor === C)); garbage(30); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C31 { m() { return 31; } }
Error.captureStackTrace(C31.prototype); garbage(31);
{ const C = C31, P = C.prototype; note(String(P.constructor === C)); garbage(31); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C32 { m() { return 1; } get g() { return 3; } set g(v) {} }
new One(C32.prototype); new Twelve(C32.prototype); new Brand(C32.prototype); Error.captureStackTrace(C32.prototype); garbage(32);
{ const C = C32, P = C.prototype; note(String(P.constructor === C)); garbage(32); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C33 { stack() { return "declared"; } m() {} }
new Twelve(C33.prototype); new One(C33); garbage(33);
{ const C = C33, P = C.prototype; note(String(P.constructor === C)); garbage(33); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C34 { a() {} b() {} c() {} d() {} m() {} }
 garbage(34);
{ const C = C34, P = C.prototype; note(String(P.constructor === C)); garbage(34); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C35 {  }
new One(C35.prototype); garbage(35);
{ const C = C35, P = C.prototype; note(String(typeof new C().m)); garbage(35); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C36 { m() { return 36; } }
new Twelve(C36.prototype); garbage(36);
{ const C = C36, P = C.prototype; note(String(typeof new C().m)); garbage(36); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C37 { m() { return 1; } get g() { return 3; } set g(v) {} }
new Brand(C37.prototype); garbage(37);
{ const C = C37, P = C.prototype; note(String(typeof new C().m)); garbage(37); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C38 { stack() { return "declared"; } m() {} }
Error.captureStackTrace(C38.prototype); garbage(38);
{ const C = C38, P = C.prototype; note(String(typeof new C().m)); garbage(38); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C39 { a() {} b() {} c() {} d() {} m() {} }
new One(C39.prototype); new Twelve(C39.prototype); new Brand(C39.prototype); Error.captureStackTrace(C39.prototype); garbage(39);
{ const C = C39, P = C.prototype; note(String(typeof new C().m)); garbage(39); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
console.log("39 " + sum.length + " " + sum.slice(-150)); sum = "";
class C40 {  }
new Twelve(C40.prototype); new One(C40); garbage(40);
{ const C = C40, P = C.prototype; note(String(typeof new C().m)); garbage(40); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C41 { m() { return 41; } }
 garbage(41);
{ const C = C41, P = C.prototype; note(String(typeof new C().m)); garbage(41); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C42 { m() { return 1; } get g() { return 3; } set g(v) {} }
new One(C42.prototype); garbage(42);
{ const C = C42, P = C.prototype; note(String(Object.getOwnPropertyDescriptor(P, "constructor").enumerable)); garbage(42); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C43 { stack() { return "declared"; } m() {} }
new Twelve(C43.prototype); garbage(43);
{ const C = C43, P = C.prototype; note(String(Object.getOwnPropertyDescriptor(P, "constructor").enumerable)); garbage(43); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C44 { a() {} b() {} c() {} d() {} m() {} }
new Brand(C44.prototype); garbage(44);
{ const C = C44, P = C.prototype; note(String(Object.getOwnPropertyDescriptor(P, "constructor").enumerable)); garbage(44); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C45 {  }
Error.captureStackTrace(C45.prototype); garbage(45);
{ const C = C45, P = C.prototype; note(String(Object.getOwnPropertyDescriptor(P, "constructor").enumerable)); garbage(45); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C46 { m() { return 46; } }
new One(C46.prototype); new Twelve(C46.prototype); new Brand(C46.prototype); Error.captureStackTrace(C46.prototype); garbage(46);
{ const C = C46, P = C.prototype; note(String(Object.getOwnPropertyDescriptor(P, "constructor").enumerable)); garbage(46); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C47 { m() { return 1; } get g() { return 3; } set g(v) {} }
new Twelve(C47.prototype); new One(C47); garbage(47);
{ const C = C47, P = C.prototype; note(String(Object.getOwnPropertyDescriptor(P, "constructor").enumerable)); garbage(47); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C48 { stack() { return "declared"; } m() {} }
 garbage(48);
{ const C = C48, P = C.prototype; note(String(Object.getOwnPropertyDescriptor(P, "constructor").enumerable)); garbage(48); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C49 { a() {} b() {} c() {} d() {} m() {} }
new One(C49.prototype); garbage(49);
{ const C = C49, P = C.prototype; note(String(names(P))); garbage(49); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C50 {  }
new Twelve(C50.prototype); garbage(50);
{ const C = C50, P = C.prototype; note(String(names(P))); garbage(50); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C51 { m() { return 51; } }
new Brand(C51.prototype); garbage(51);
{ const C = C51, P = C.prototype; note(String(names(P))); garbage(51); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C52 { m() { return 1; } get g() { return 3; } set g(v) {} }
Error.captureStackTrace(C52.prototype); garbage(52);
{ const C = C52, P = C.prototype; note(String(names(P))); garbage(52); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C53 { stack() { return "declared"; } m() {} }
new One(C53.prototype); new Twelve(C53.prototype); new Brand(C53.prototype); Error.captureStackTrace(C53.prototype); garbage(53);
{ const C = C53, P = C.prototype; note(String(names(P))); garbage(53); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C54 { a() {} b() {} c() {} d() {} m() {} }
new Twelve(C54.prototype); new One(C54); garbage(54);
{ const C = C54, P = C.prototype; note(String(names(P))); garbage(54); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C55 {  }
 garbage(55);
{ const C = C55, P = C.prototype; note(String(names(P))); garbage(55); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C56 { m() { return 56; } }
new One(C56.prototype); garbage(56);
{ const C = C56, P = C.prototype; note(String(typeof P.m)); garbage(56); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C57 { m() { return 1; } get g() { return 3; } set g(v) {} }
new Twelve(C57.prototype); garbage(57);
{ const C = C57, P = C.prototype; note(String(typeof P.m)); garbage(57); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C58 { stack() { return "declared"; } m() {} }
new Brand(C58.prototype); garbage(58);
{ const C = C58, P = C.prototype; note(String(typeof P.m)); garbage(58); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C59 { a() {} b() {} c() {} d() {} m() {} }
Error.captureStackTrace(C59.prototype); garbage(59);
{ const C = C59, P = C.prototype; note(String(typeof P.m)); garbage(59); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
console.log("59 " + sum.length + " " + sum.slice(-150)); sum = "";
class C60 {  }
new One(C60.prototype); new Twelve(C60.prototype); new Brand(C60.prototype); Error.captureStackTrace(C60.prototype); garbage(60);
{ const C = C60, P = C.prototype; note(String(typeof P.m)); garbage(60); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C61 { m() { return 61; } }
new Twelve(C61.prototype); new One(C61); garbage(61);
{ const C = C61, P = C.prototype; note(String(typeof P.m)); garbage(61); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C62 { m() { return 1; } get g() { return 3; } set g(v) {} }
 garbage(62);
{ const C = C62, P = C.prototype; note(String(typeof P.m)); garbage(62); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C63 { stack() { return "declared"; } m() {} }
new One(C63.prototype); garbage(63);
{ const C = C63, P = C.prototype; note(String("m" in P)); garbage(63); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C64 { a() {} b() {} c() {} d() {} m() {} }
new Twelve(C64.prototype); garbage(64);
{ const C = C64, P = C.prototype; note(String("m" in P)); garbage(64); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C65 {  }
new Brand(C65.prototype); garbage(65);
{ const C = C65, P = C.prototype; note(String("m" in P)); garbage(65); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C66 { m() { return 66; } }
Error.captureStackTrace(C66.prototype); garbage(66);
{ const C = C66, P = C.prototype; note(String("m" in P)); garbage(66); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C67 { m() { return 1; } get g() { return 3; } set g(v) {} }
new One(C67.prototype); new Twelve(C67.prototype); new Brand(C67.prototype); Error.captureStackTrace(C67.prototype); garbage(67);
{ const C = C67, P = C.prototype; note(String("m" in P)); garbage(67); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C68 { stack() { return "declared"; } m() {} }
new Twelve(C68.prototype); new One(C68); garbage(68);
{ const C = C68, P = C.prototype; note(String("m" in P)); garbage(68); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C69 { a() {} b() {} c() {} d() {} m() {} }
 garbage(69);
{ const C = C69, P = C.prototype; note(String("m" in P)); garbage(69); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C70 {  }
new One(C70.prototype); garbage(70);
{ const C = C70, P = C.prototype; note(String(Object.keys(P).length)); garbage(70); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C71 { m() { return 71; } }
new Twelve(C71.prototype); garbage(71);
{ const C = C71, P = C.prototype; note(String(Object.keys(P).length)); garbage(71); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C72 { m() { return 1; } get g() { return 3; } set g(v) {} }
new Brand(C72.prototype); garbage(72);
{ const C = C72, P = C.prototype; note(String(Object.keys(P).length)); garbage(72); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C73 { stack() { return "declared"; } m() {} }
Error.captureStackTrace(C73.prototype); garbage(73);
{ const C = C73, P = C.prototype; note(String(Object.keys(P).length)); garbage(73); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C74 { a() {} b() {} c() {} d() {} m() {} }
new One(C74.prototype); new Twelve(C74.prototype); new Brand(C74.prototype); Error.captureStackTrace(C74.prototype); garbage(74);
{ const C = C74, P = C.prototype; note(String(Object.keys(P).length)); garbage(74); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C75 {  }
new Twelve(C75.prototype); new One(C75); garbage(75);
{ const C = C75, P = C.prototype; note(String(Object.keys(P).length)); garbage(75); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C76 { m() { return 76; } }
 garbage(76);
{ const C = C76, P = C.prototype; note(String(Object.keys(P).length)); garbage(76); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C77 { m() { return 1; } get g() { return 3; } set g(v) {} }
new One(C77.prototype); garbage(77);
{ const C = C77, P = C.prototype; note(String(P.constructor === C)); garbage(77); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C78 { stack() { return "declared"; } m() {} }
new Twelve(C78.prototype); garbage(78);
{ const C = C78, P = C.prototype; note(String(P.constructor === C)); garbage(78); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C79 { a() {} b() {} c() {} d() {} m() {} }
new Brand(C79.prototype); garbage(79);
{ const C = C79, P = C.prototype; note(String(P.constructor === C)); garbage(79); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
console.log("79 " + sum.length + " " + sum.slice(-150)); sum = "";
class C80 {  }
Error.captureStackTrace(C80.prototype); garbage(80);
{ const C = C80, P = C.prototype; note(String(P.constructor === C)); garbage(80); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C81 { m() { return 81; } }
new One(C81.prototype); new Twelve(C81.prototype); new Brand(C81.prototype); Error.captureStackTrace(C81.prototype); garbage(81);
{ const C = C81, P = C.prototype; note(String(P.constructor === C)); garbage(81); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C82 { m() { return 1; } get g() { return 3; } set g(v) {} }
new Twelve(C82.prototype); new One(C82); garbage(82);
{ const C = C82, P = C.prototype; note(String(P.constructor === C)); garbage(82); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C83 { stack() { return "declared"; } m() {} }
 garbage(83);
{ const C = C83, P = C.prototype; note(String(P.constructor === C)); garbage(83); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C84 { a() {} b() {} c() {} d() {} m() {} }
new One(C84.prototype); garbage(84);
{ const C = C84, P = C.prototype; note(String(typeof new C().m)); garbage(84); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C85 {  }
new Twelve(C85.prototype); garbage(85);
{ const C = C85, P = C.prototype; note(String(typeof new C().m)); garbage(85); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C86 { m() { return 86; } }
new Brand(C86.prototype); garbage(86);
{ const C = C86, P = C.prototype; note(String(typeof new C().m)); garbage(86); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C87 { m() { return 1; } get g() { return 3; } set g(v) {} }
Error.captureStackTrace(C87.prototype); garbage(87);
{ const C = C87, P = C.prototype; note(String(typeof new C().m)); garbage(87); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C88 { stack() { return "declared"; } m() {} }
new One(C88.prototype); new Twelve(C88.prototype); new Brand(C88.prototype); Error.captureStackTrace(C88.prototype); garbage(88);
{ const C = C88, P = C.prototype; note(String(typeof new C().m)); garbage(88); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C89 { a() {} b() {} c() {} d() {} m() {} }
new Twelve(C89.prototype); new One(C89); garbage(89);
{ const C = C89, P = C.prototype; note(String(typeof new C().m)); garbage(89); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C90 {  }
 garbage(90);
{ const C = C90, P = C.prototype; note(String(typeof new C().m)); garbage(90); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C91 { m() { return 91; } }
new One(C91.prototype); garbage(91);
{ const C = C91, P = C.prototype; note(String(Object.getOwnPropertyDescriptor(P, "constructor").enumerable)); garbage(91); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C92 { m() { return 1; } get g() { return 3; } set g(v) {} }
new Twelve(C92.prototype); garbage(92);
{ const C = C92, P = C.prototype; note(String(Object.getOwnPropertyDescriptor(P, "constructor").enumerable)); garbage(92); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C93 { stack() { return "declared"; } m() {} }
new Brand(C93.prototype); garbage(93);
{ const C = C93, P = C.prototype; note(String(Object.getOwnPropertyDescriptor(P, "constructor").enumerable)); garbage(93); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C94 { a() {} b() {} c() {} d() {} m() {} }
Error.captureStackTrace(C94.prototype); garbage(94);
{ const C = C94, P = C.prototype; note(String(Object.getOwnPropertyDescriptor(P, "constructor").enumerable)); garbage(94); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C95 {  }
new One(C95.prototype); new Twelve(C95.prototype); new Brand(C95.prototype); Error.captureStackTrace(C95.prototype); garbage(95);
{ const C = C95, P = C.prototype; note(String(Object.getOwnPropertyDescriptor(P, "constructor").enumerable)); garbage(95); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C96 { m() { return 96; } }
new Twelve(C96.prototype); new One(C96); garbage(96);
{ const C = C96, P = C.prototype; note(String(Object.getOwnPropertyDescriptor(P, "constructor").enumerable)); garbage(96); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C97 { m() { return 1; } get g() { return 3; } set g(v) {} }
 garbage(97);
{ const C = C97, P = C.prototype; note(String(Object.getOwnPropertyDescriptor(P, "constructor").enumerable)); garbage(97); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C98 { stack() { return "declared"; } m() {} }
new One(C98.prototype); garbage(98);
{ const C = C98, P = C.prototype; note(String(names(P))); garbage(98); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C99 { a() {} b() {} c() {} d() {} m() {} }
new Twelve(C99.prototype); garbage(99);
{ const C = C99, P = C.prototype; note(String(names(P))); garbage(99); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
console.log("99 " + sum.length + " " + sum.slice(-150)); sum = "";
class C100 {  }
new Brand(C100.prototype); garbage(100);
{ const C = C100, P = C.prototype; note(String(names(P))); garbage(100); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C101 { m() { return 101; } }
Error.captureStackTrace(C101.prototype); garbage(101);
{ const C = C101, P = C.prototype; note(String(names(P))); garbage(101); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C102 { m() { return 1; } get g() { return 3; } set g(v) {} }
new One(C102.prototype); new Twelve(C102.prototype); new Brand(C102.prototype); Error.captureStackTrace(C102.prototype); garbage(102);
{ const C = C102, P = C.prototype; note(String(names(P))); garbage(102); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C103 { stack() { return "declared"; } m() {} }
new Twelve(C103.prototype); new One(C103); garbage(103);
{ const C = C103, P = C.prototype; note(String(names(P))); garbage(103); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C104 { a() {} b() {} c() {} d() {} m() {} }
 garbage(104);
{ const C = C104, P = C.prototype; note(String(names(P))); garbage(104); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C105 {  }
new One(C105.prototype); garbage(105);
{ const C = C105, P = C.prototype; note(String(typeof P.m)); garbage(105); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C106 { m() { return 106; } }
new Twelve(C106.prototype); garbage(106);
{ const C = C106, P = C.prototype; note(String(typeof P.m)); garbage(106); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C107 { m() { return 1; } get g() { return 3; } set g(v) {} }
new Brand(C107.prototype); garbage(107);
{ const C = C107, P = C.prototype; note(String(typeof P.m)); garbage(107); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C108 { stack() { return "declared"; } m() {} }
Error.captureStackTrace(C108.prototype); garbage(108);
{ const C = C108, P = C.prototype; note(String(typeof P.m)); garbage(108); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C109 { a() {} b() {} c() {} d() {} m() {} }
new One(C109.prototype); new Twelve(C109.prototype); new Brand(C109.prototype); Error.captureStackTrace(C109.prototype); garbage(109);
{ const C = C109, P = C.prototype; note(String(typeof P.m)); garbage(109); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C110 {  }
new Twelve(C110.prototype); new One(C110); garbage(110);
{ const C = C110, P = C.prototype; note(String(typeof P.m)); garbage(110); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C111 { m() { return 111; } }
 garbage(111);
{ const C = C111, P = C.prototype; note(String(typeof P.m)); garbage(111); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C112 { m() { return 1; } get g() { return 3; } set g(v) {} }
new One(C112.prototype); garbage(112);
{ const C = C112, P = C.prototype; note(String("m" in P)); garbage(112); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C113 { stack() { return "declared"; } m() {} }
new Twelve(C113.prototype); garbage(113);
{ const C = C113, P = C.prototype; note(String("m" in P)); garbage(113); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C114 { a() {} b() {} c() {} d() {} m() {} }
new Brand(C114.prototype); garbage(114);
{ const C = C114, P = C.prototype; note(String("m" in P)); garbage(114); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C115 {  }
Error.captureStackTrace(C115.prototype); garbage(115);
{ const C = C115, P = C.prototype; note(String("m" in P)); garbage(115); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C116 { m() { return 116; } }
new One(C116.prototype); new Twelve(C116.prototype); new Brand(C116.prototype); Error.captureStackTrace(C116.prototype); garbage(116);
{ const C = C116, P = C.prototype; note(String("m" in P)); garbage(116); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C117 { m() { return 1; } get g() { return 3; } set g(v) {} }
new Twelve(C117.prototype); new One(C117); garbage(117);
{ const C = C117, P = C.prototype; note(String("m" in P)); garbage(117); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C118 { stack() { return "declared"; } m() {} }
 garbage(118);
{ const C = C118, P = C.prototype; note(String("m" in P)); garbage(118); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C119 { a() {} b() {} c() {} d() {} m() {} }
new One(C119.prototype); garbage(119);
{ const C = C119, P = C.prototype; note(String(Object.keys(P).length)); garbage(119); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
console.log("119 " + sum.length + " " + sum.slice(-150)); sum = "";
class C120 {  }
new Twelve(C120.prototype); garbage(120);
{ const C = C120, P = C.prototype; note(String(Object.keys(P).length)); garbage(120); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C121 { m() { return 121; } }
new Brand(C121.prototype); garbage(121);
{ const C = C121, P = C.prototype; note(String(Object.keys(P).length)); garbage(121); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C122 { m() { return 1; } get g() { return 3; } set g(v) {} }
Error.captureStackTrace(C122.prototype); garbage(122);
{ const C = C122, P = C.prototype; note(String(Object.keys(P).length)); garbage(122); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C123 { stack() { return "declared"; } m() {} }
new One(C123.prototype); new Twelve(C123.prototype); new Brand(C123.prototype); Error.captureStackTrace(C123.prototype); garbage(123);
{ const C = C123, P = C.prototype; note(String(Object.keys(P).length)); garbage(123); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C124 { a() {} b() {} c() {} d() {} m() {} }
new Twelve(C124.prototype); new One(C124); garbage(124);
{ const C = C124, P = C.prototype; note(String(Object.keys(P).length)); garbage(124); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C125 {  }
 garbage(125);
{ const C = C125, P = C.prototype; note(String(Object.keys(P).length)); garbage(125); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C126 { m() { return 126; } }
new One(C126.prototype); garbage(126);
{ const C = C126, P = C.prototype; note(String(P.constructor === C)); garbage(126); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C127 { m() { return 1; } get g() { return 3; } set g(v) {} }
new Twelve(C127.prototype); garbage(127);
{ const C = C127, P = C.prototype; note(String(P.constructor === C)); garbage(127); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C128 { stack() { return "declared"; } m() {} }
new Brand(C128.prototype); garbage(128);
{ const C = C128, P = C.prototype; note(String(P.constructor === C)); garbage(128); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C129 { a() {} b() {} c() {} d() {} m() {} }
Error.captureStackTrace(C129.prototype); garbage(129);
{ const C = C129, P = C.prototype; note(String(P.constructor === C)); garbage(129); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C130 {  }
new One(C130.prototype); new Twelve(C130.prototype); new Brand(C130.prototype); Error.captureStackTrace(C130.prototype); garbage(130);
{ const C = C130, P = C.prototype; note(String(P.constructor === C)); garbage(130); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C131 { m() { return 131; } }
new Twelve(C131.prototype); new One(C131); garbage(131);
{ const C = C131, P = C.prototype; note(String(P.constructor === C)); garbage(131); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C132 { m() { return 1; } get g() { return 3; } set g(v) {} }
 garbage(132);
{ const C = C132, P = C.prototype; note(String(P.constructor === C)); garbage(132); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C133 { stack() { return "declared"; } m() {} }
new One(C133.prototype); garbage(133);
{ const C = C133, P = C.prototype; note(String(typeof new C().m)); garbage(133); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C134 { a() {} b() {} c() {} d() {} m() {} }
new Twelve(C134.prototype); garbage(134);
{ const C = C134, P = C.prototype; note(String(typeof new C().m)); garbage(134); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C135 {  }
new Brand(C135.prototype); garbage(135);
{ const C = C135, P = C.prototype; note(String(typeof new C().m)); garbage(135); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C136 { m() { return 136; } }
Error.captureStackTrace(C136.prototype); garbage(136);
{ const C = C136, P = C.prototype; note(String(typeof new C().m)); garbage(136); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C137 { m() { return 1; } get g() { return 3; } set g(v) {} }
new One(C137.prototype); new Twelve(C137.prototype); new Brand(C137.prototype); Error.captureStackTrace(C137.prototype); garbage(137);
{ const C = C137, P = C.prototype; note(String(typeof new C().m)); garbage(137); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C138 { stack() { return "declared"; } m() {} }
new Twelve(C138.prototype); new One(C138); garbage(138);
{ const C = C138, P = C.prototype; note(String(typeof new C().m)); garbage(138); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C139 { a() {} b() {} c() {} d() {} m() {} }
 garbage(139);
{ const C = C139, P = C.prototype; note(String(typeof new C().m)); garbage(139); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
console.log("139 " + sum.length + " " + sum.slice(-150)); sum = "";
class C140 {  }
new One(C140.prototype); garbage(140);
{ const C = C140, P = C.prototype; note(String(Object.getOwnPropertyDescriptor(P, "constructor").enumerable)); garbage(140); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C141 { m() { return 141; } }
new Twelve(C141.prototype); garbage(141);
{ const C = C141, P = C.prototype; note(String(Object.getOwnPropertyDescriptor(P, "constructor").enumerable)); garbage(141); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C142 { m() { return 1; } get g() { return 3; } set g(v) {} }
new Brand(C142.prototype); garbage(142);
{ const C = C142, P = C.prototype; note(String(Object.getOwnPropertyDescriptor(P, "constructor").enumerable)); garbage(142); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C143 { stack() { return "declared"; } m() {} }
Error.captureStackTrace(C143.prototype); garbage(143);
{ const C = C143, P = C.prototype; note(String(Object.getOwnPropertyDescriptor(P, "constructor").enumerable)); garbage(143); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C144 { a() {} b() {} c() {} d() {} m() {} }
new One(C144.prototype); new Twelve(C144.prototype); new Brand(C144.prototype); Error.captureStackTrace(C144.prototype); garbage(144);
{ const C = C144, P = C.prototype; note(String(Object.getOwnPropertyDescriptor(P, "constructor").enumerable)); garbage(144); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C145 {  }
new Twelve(C145.prototype); new One(C145); garbage(145);
{ const C = C145, P = C.prototype; note(String(Object.getOwnPropertyDescriptor(P, "constructor").enumerable)); garbage(145); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C146 { m() { return 146; } }
 garbage(146);
{ const C = C146, P = C.prototype; note(String(Object.getOwnPropertyDescriptor(P, "constructor").enumerable)); garbage(146); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C147 { m() { return 1; } get g() { return 3; } set g(v) {} }
new One(C147.prototype); garbage(147);
{ const C = C147, P = C.prototype; note(String(names(P))); garbage(147); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C148 { stack() { return "declared"; } m() {} }
new Twelve(C148.prototype); garbage(148);
{ const C = C148, P = C.prototype; note(String(names(P))); garbage(148); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C149 { a() {} b() {} c() {} d() {} m() {} }
new Brand(C149.prototype); garbage(149);
{ const C = C149, P = C.prototype; note(String(names(P))); garbage(149); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C150 {  }
Error.captureStackTrace(C150.prototype); garbage(150);
{ const C = C150, P = C.prototype; note(String(names(P))); garbage(150); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C151 { m() { return 151; } }
new One(C151.prototype); new Twelve(C151.prototype); new Brand(C151.prototype); Error.captureStackTrace(C151.prototype); garbage(151);
{ const C = C151, P = C.prototype; note(String(names(P))); garbage(151); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C152 { m() { return 1; } get g() { return 3; } set g(v) {} }
new Twelve(C152.prototype); new One(C152); garbage(152);
{ const C = C152, P = C.prototype; note(String(names(P))); garbage(152); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C153 { stack() { return "declared"; } m() {} }
 garbage(153);
{ const C = C153, P = C.prototype; note(String(names(P))); garbage(153); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C154 { a() {} b() {} c() {} d() {} m() {} }
new One(C154.prototype); garbage(154);
{ const C = C154, P = C.prototype; note(String(typeof P.m)); garbage(154); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C155 {  }
new Twelve(C155.prototype); garbage(155);
{ const C = C155, P = C.prototype; note(String(typeof P.m)); garbage(155); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C156 { m() { return 156; } }
new Brand(C156.prototype); garbage(156);
{ const C = C156, P = C.prototype; note(String(typeof P.m)); garbage(156); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C157 { m() { return 1; } get g() { return 3; } set g(v) {} }
Error.captureStackTrace(C157.prototype); garbage(157);
{ const C = C157, P = C.prototype; note(String(typeof P.m)); garbage(157); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C158 { stack() { return "declared"; } m() {} }
new One(C158.prototype); new Twelve(C158.prototype); new Brand(C158.prototype); Error.captureStackTrace(C158.prototype); garbage(158);
{ const C = C158, P = C.prototype; note(String(typeof P.m)); garbage(158); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C159 { a() {} b() {} c() {} d() {} m() {} }
new Twelve(C159.prototype); new One(C159); garbage(159);
{ const C = C159, P = C.prototype; note(String(typeof P.m)); garbage(159); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
console.log("159 " + sum.length + " " + sum.slice(-150)); sum = "";
class C160 {  }
 garbage(160);
{ const C = C160, P = C.prototype; note(String(typeof P.m)); garbage(160); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C161 { m() { return 161; } }
new One(C161.prototype); garbage(161);
{ const C = C161, P = C.prototype; note(String("m" in P)); garbage(161); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C162 { m() { return 1; } get g() { return 3; } set g(v) {} }
new Twelve(C162.prototype); garbage(162);
{ const C = C162, P = C.prototype; note(String("m" in P)); garbage(162); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C163 { stack() { return "declared"; } m() {} }
new Brand(C163.prototype); garbage(163);
{ const C = C163, P = C.prototype; note(String("m" in P)); garbage(163); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C164 { a() {} b() {} c() {} d() {} m() {} }
Error.captureStackTrace(C164.prototype); garbage(164);
{ const C = C164, P = C.prototype; note(String("m" in P)); garbage(164); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C165 {  }
new One(C165.prototype); new Twelve(C165.prototype); new Brand(C165.prototype); Error.captureStackTrace(C165.prototype); garbage(165);
{ const C = C165, P = C.prototype; note(String("m" in P)); garbage(165); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C166 { m() { return 166; } }
new Twelve(C166.prototype); new One(C166); garbage(166);
{ const C = C166, P = C.prototype; note(String("m" in P)); garbage(166); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C167 { m() { return 1; } get g() { return 3; } set g(v) {} }
 garbage(167);
{ const C = C167, P = C.prototype; note(String("m" in P)); garbage(167); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C168 { stack() { return "declared"; } m() {} }
new One(C168.prototype); garbage(168);
{ const C = C168, P = C.prototype; note(String(Object.keys(P).length)); garbage(168); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C169 { a() {} b() {} c() {} d() {} m() {} }
new Twelve(C169.prototype); garbage(169);
{ const C = C169, P = C.prototype; note(String(Object.keys(P).length)); garbage(169); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C170 {  }
new Brand(C170.prototype); garbage(170);
{ const C = C170, P = C.prototype; note(String(Object.keys(P).length)); garbage(170); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C171 { m() { return 171; } }
Error.captureStackTrace(C171.prototype); garbage(171);
{ const C = C171, P = C.prototype; note(String(Object.keys(P).length)); garbage(171); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C172 { m() { return 1; } get g() { return 3; } set g(v) {} }
new One(C172.prototype); new Twelve(C172.prototype); new Brand(C172.prototype); Error.captureStackTrace(C172.prototype); garbage(172);
{ const C = C172, P = C.prototype; note(String(Object.keys(P).length)); garbage(172); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C173 { stack() { return "declared"; } m() {} }
new Twelve(C173.prototype); new One(C173); garbage(173);
{ const C = C173, P = C.prototype; note(String(Object.keys(P).length)); garbage(173); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C174 { a() {} b() {} c() {} d() {} m() {} }
 garbage(174);
{ const C = C174, P = C.prototype; note(String(Object.keys(P).length)); garbage(174); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C175 {  }
new One(C175.prototype); garbage(175);
{ const C = C175, P = C.prototype; note(String(P.constructor === C)); garbage(175); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C176 { m() { return 176; } }
new Twelve(C176.prototype); garbage(176);
{ const C = C176, P = C.prototype; note(String(P.constructor === C)); garbage(176); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C177 { m() { return 1; } get g() { return 3; } set g(v) {} }
new Brand(C177.prototype); garbage(177);
{ const C = C177, P = C.prototype; note(String(P.constructor === C)); garbage(177); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C178 { stack() { return "declared"; } m() {} }
Error.captureStackTrace(C178.prototype); garbage(178);
{ const C = C178, P = C.prototype; note(String(P.constructor === C)); garbage(178); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C179 { a() {} b() {} c() {} d() {} m() {} }
new One(C179.prototype); new Twelve(C179.prototype); new Brand(C179.prototype); Error.captureStackTrace(C179.prototype); garbage(179);
{ const C = C179, P = C.prototype; note(String(P.constructor === C)); garbage(179); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
console.log("179 " + sum.length + " " + sum.slice(-150)); sum = "";
class C180 {  }
new Twelve(C180.prototype); new One(C180); garbage(180);
{ const C = C180, P = C.prototype; note(String(P.constructor === C)); garbage(180); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C181 { m() { return 181; } }
 garbage(181);
{ const C = C181, P = C.prototype; note(String(P.constructor === C)); garbage(181); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C182 { m() { return 1; } get g() { return 3; } set g(v) {} }
new One(C182.prototype); garbage(182);
{ const C = C182, P = C.prototype; note(String(typeof new C().m)); garbage(182); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C183 { stack() { return "declared"; } m() {} }
new Twelve(C183.prototype); garbage(183);
{ const C = C183, P = C.prototype; note(String(typeof new C().m)); garbage(183); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C184 { a() {} b() {} c() {} d() {} m() {} }
new Brand(C184.prototype); garbage(184);
{ const C = C184, P = C.prototype; note(String(typeof new C().m)); garbage(184); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C185 {  }
Error.captureStackTrace(C185.prototype); garbage(185);
{ const C = C185, P = C.prototype; note(String(typeof new C().m)); garbage(185); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C186 { m() { return 186; } }
new One(C186.prototype); new Twelve(C186.prototype); new Brand(C186.prototype); Error.captureStackTrace(C186.prototype); garbage(186);
{ const C = C186, P = C.prototype; note(String(typeof new C().m)); garbage(186); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C187 { m() { return 1; } get g() { return 3; } set g(v) {} }
new Twelve(C187.prototype); new One(C187); garbage(187);
{ const C = C187, P = C.prototype; note(String(typeof new C().m)); garbage(187); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C188 { stack() { return "declared"; } m() {} }
 garbage(188);
{ const C = C188, P = C.prototype; note(String(typeof new C().m)); garbage(188); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C189 { a() {} b() {} c() {} d() {} m() {} }
new One(C189.prototype); garbage(189);
{ const C = C189, P = C.prototype; note(String(Object.getOwnPropertyDescriptor(P, "constructor").enumerable)); garbage(189); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C190 {  }
new Twelve(C190.prototype); garbage(190);
{ const C = C190, P = C.prototype; note(String(Object.getOwnPropertyDescriptor(P, "constructor").enumerable)); garbage(190); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C191 { m() { return 191; } }
new Brand(C191.prototype); garbage(191);
{ const C = C191, P = C.prototype; note(String(Object.getOwnPropertyDescriptor(P, "constructor").enumerable)); garbage(191); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C192 { m() { return 1; } get g() { return 3; } set g(v) {} }
Error.captureStackTrace(C192.prototype); garbage(192);
{ const C = C192, P = C.prototype; note(String(Object.getOwnPropertyDescriptor(P, "constructor").enumerable)); garbage(192); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C193 { stack() { return "declared"; } m() {} }
new One(C193.prototype); new Twelve(C193.prototype); new Brand(C193.prototype); Error.captureStackTrace(C193.prototype); garbage(193);
{ const C = C193, P = C.prototype; note(String(Object.getOwnPropertyDescriptor(P, "constructor").enumerable)); garbage(193); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C194 { a() {} b() {} c() {} d() {} m() {} }
new Twelve(C194.prototype); new One(C194); garbage(194);
{ const C = C194, P = C.prototype; note(String(Object.getOwnPropertyDescriptor(P, "constructor").enumerable)); garbage(194); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C195 {  }
 garbage(195);
{ const C = C195, P = C.prototype; note(String(Object.getOwnPropertyDescriptor(P, "constructor").enumerable)); garbage(195); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C196 { m() { return 196; } }
new One(C196.prototype); garbage(196);
{ const C = C196, P = C.prototype; note(String(names(P))); garbage(196); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C197 { m() { return 1; } get g() { return 3; } set g(v) {} }
new Twelve(C197.prototype); garbage(197);
{ const C = C197, P = C.prototype; note(String(names(P))); garbage(197); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C198 { stack() { return "declared"; } m() {} }
new Brand(C198.prototype); garbage(198);
{ const C = C198, P = C.prototype; note(String(names(P))); garbage(198); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C199 { a() {} b() {} c() {} d() {} m() {} }
Error.captureStackTrace(C199.prototype); garbage(199);
{ const C = C199, P = C.prototype; note(String(names(P))); garbage(199); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
console.log("199 " + sum.length + " " + sum.slice(-150)); sum = "";
class C200 {  }
new One(C200.prototype); new Twelve(C200.prototype); new Brand(C200.prototype); Error.captureStackTrace(C200.prototype); garbage(200);
{ const C = C200, P = C.prototype; note(String(names(P))); garbage(200); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C201 { m() { return 201; } }
new Twelve(C201.prototype); new One(C201); garbage(201);
{ const C = C201, P = C.prototype; note(String(names(P))); garbage(201); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C202 { m() { return 1; } get g() { return 3; } set g(v) {} }
 garbage(202);
{ const C = C202, P = C.prototype; note(String(names(P))); garbage(202); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C203 { stack() { return "declared"; } m() {} }
new One(C203.prototype); garbage(203);
{ const C = C203, P = C.prototype; note(String(typeof P.m)); garbage(203); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C204 { a() {} b() {} c() {} d() {} m() {} }
new Twelve(C204.prototype); garbage(204);
{ const C = C204, P = C.prototype; note(String(typeof P.m)); garbage(204); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C205 {  }
new Brand(C205.prototype); garbage(205);
{ const C = C205, P = C.prototype; note(String(typeof P.m)); garbage(205); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C206 { m() { return 206; } }
Error.captureStackTrace(C206.prototype); garbage(206);
{ const C = C206, P = C.prototype; note(String(typeof P.m)); garbage(206); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C207 { m() { return 1; } get g() { return 3; } set g(v) {} }
new One(C207.prototype); new Twelve(C207.prototype); new Brand(C207.prototype); Error.captureStackTrace(C207.prototype); garbage(207);
{ const C = C207, P = C.prototype; note(String(typeof P.m)); garbage(207); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C208 { stack() { return "declared"; } m() {} }
new Twelve(C208.prototype); new One(C208); garbage(208);
{ const C = C208, P = C.prototype; note(String(typeof P.m)); garbage(208); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C209 { a() {} b() {} c() {} d() {} m() {} }
 garbage(209);
{ const C = C209, P = C.prototype; note(String(typeof P.m)); garbage(209); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C210 {  }
new One(C210.prototype); garbage(210);
{ const C = C210, P = C.prototype; note(String("m" in P)); garbage(210); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C211 { m() { return 211; } }
new Twelve(C211.prototype); garbage(211);
{ const C = C211, P = C.prototype; note(String("m" in P)); garbage(211); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C212 { m() { return 1; } get g() { return 3; } set g(v) {} }
new Brand(C212.prototype); garbage(212);
{ const C = C212, P = C.prototype; note(String("m" in P)); garbage(212); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C213 { stack() { return "declared"; } m() {} }
Error.captureStackTrace(C213.prototype); garbage(213);
{ const C = C213, P = C.prototype; note(String("m" in P)); garbage(213); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C214 { a() {} b() {} c() {} d() {} m() {} }
new One(C214.prototype); new Twelve(C214.prototype); new Brand(C214.prototype); Error.captureStackTrace(C214.prototype); garbage(214);
{ const C = C214, P = C.prototype; note(String("m" in P)); garbage(214); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C215 {  }
new Twelve(C215.prototype); new One(C215); garbage(215);
{ const C = C215, P = C.prototype; note(String("m" in P)); garbage(215); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C216 { m() { return 216; } }
 garbage(216);
{ const C = C216, P = C.prototype; note(String("m" in P)); garbage(216); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C217 { m() { return 1; } get g() { return 3; } set g(v) {} }
new One(C217.prototype); garbage(217);
{ const C = C217, P = C.prototype; note(String(Object.keys(P).length)); garbage(217); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C218 { stack() { return "declared"; } m() {} }
new Twelve(C218.prototype); garbage(218);
{ const C = C218, P = C.prototype; note(String(Object.keys(P).length)); garbage(218); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C219 { a() {} b() {} c() {} d() {} m() {} }
new Brand(C219.prototype); garbage(219);
{ const C = C219, P = C.prototype; note(String(Object.keys(P).length)); garbage(219); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
console.log("219 " + sum.length + " " + sum.slice(-150)); sum = "";
class C220 {  }
Error.captureStackTrace(C220.prototype); garbage(220);
{ const C = C220, P = C.prototype; note(String(Object.keys(P).length)); garbage(220); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C221 { m() { return 221; } }
new One(C221.prototype); new Twelve(C221.prototype); new Brand(C221.prototype); Error.captureStackTrace(C221.prototype); garbage(221);
{ const C = C221, P = C.prototype; note(String(Object.keys(P).length)); garbage(221); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C222 { m() { return 1; } get g() { return 3; } set g(v) {} }
new Twelve(C222.prototype); new One(C222); garbage(222);
{ const C = C222, P = C.prototype; note(String(Object.keys(P).length)); garbage(222); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C223 { stack() { return "declared"; } m() {} }
 garbage(223);
{ const C = C223, P = C.prototype; note(String(Object.keys(P).length)); garbage(223); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C224 { a() {} b() {} c() {} d() {} m() {} }
new One(C224.prototype); garbage(224);
{ const C = C224, P = C.prototype; note(String(P.constructor === C)); garbage(224); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C225 {  }
new Twelve(C225.prototype); garbage(225);
{ const C = C225, P = C.prototype; note(String(P.constructor === C)); garbage(225); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C226 { m() { return 226; } }
new Brand(C226.prototype); garbage(226);
{ const C = C226, P = C.prototype; note(String(P.constructor === C)); garbage(226); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C227 { m() { return 1; } get g() { return 3; } set g(v) {} }
Error.captureStackTrace(C227.prototype); garbage(227);
{ const C = C227, P = C.prototype; note(String(P.constructor === C)); garbage(227); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C228 { stack() { return "declared"; } m() {} }
new One(C228.prototype); new Twelve(C228.prototype); new Brand(C228.prototype); Error.captureStackTrace(C228.prototype); garbage(228);
{ const C = C228, P = C.prototype; note(String(P.constructor === C)); garbage(228); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C229 { a() {} b() {} c() {} d() {} m() {} }
new Twelve(C229.prototype); new One(C229); garbage(229);
{ const C = C229, P = C.prototype; note(String(P.constructor === C)); garbage(229); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C230 {  }
 garbage(230);
{ const C = C230, P = C.prototype; note(String(P.constructor === C)); garbage(230); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C231 { m() { return 231; } }
new One(C231.prototype); garbage(231);
{ const C = C231, P = C.prototype; note(String(typeof new C().m)); garbage(231); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C232 { m() { return 1; } get g() { return 3; } set g(v) {} }
new Twelve(C232.prototype); garbage(232);
{ const C = C232, P = C.prototype; note(String(typeof new C().m)); garbage(232); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C233 { stack() { return "declared"; } m() {} }
new Brand(C233.prototype); garbage(233);
{ const C = C233, P = C.prototype; note(String(typeof new C().m)); garbage(233); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C234 { a() {} b() {} c() {} d() {} m() {} }
Error.captureStackTrace(C234.prototype); garbage(234);
{ const C = C234, P = C.prototype; note(String(typeof new C().m)); garbage(234); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C235 {  }
new One(C235.prototype); new Twelve(C235.prototype); new Brand(C235.prototype); Error.captureStackTrace(C235.prototype); garbage(235);
{ const C = C235, P = C.prototype; note(String(typeof new C().m)); garbage(235); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C236 { m() { return 236; } }
new Twelve(C236.prototype); new One(C236); garbage(236);
{ const C = C236, P = C.prototype; note(String(typeof new C().m)); garbage(236); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C237 { m() { return 1; } get g() { return 3; } set g(v) {} }
 garbage(237);
{ const C = C237, P = C.prototype; note(String(typeof new C().m)); garbage(237); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C238 { stack() { return "declared"; } m() {} }
new One(C238.prototype); garbage(238);
{ const C = C238, P = C.prototype; note(String(Object.getOwnPropertyDescriptor(P, "constructor").enumerable)); garbage(238); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
class C239 { a() {} b() {} c() {} d() {} m() {} }
new Twelve(C239.prototype); garbage(239);
{ const C = C239, P = C.prototype; note(String(Object.getOwnPropertyDescriptor(P, "constructor").enumerable)); garbage(239); note([names(P), typeof P.stack, One.has(P) && One.read(P), Twelve.has(P) && Twelve.read(P), Brand.has(P) && Brand.read(P), One.has(new C()), new C() instanceof C, Object.getPrototypeOf(new C()) === P, Object.getPrototypeOf(P) === Object.prototype, One.has(C)].join()); }
console.log("239 " + sum.length + " " + sum.slice(-150)); sum = "";
if (typeof gc === "function") gc();
console.log("behind a collection " + [C0, C1, C4, C5].map(C => [names(C.prototype), One.has(C.prototype), Twelve.has(C.prototype) && Twelve.read(C.prototype)].join()).join(" "));
