// Making `this` has no position of its own: an error out of reading the prototype of new.target is reported at the first position that the constructor records.
// Here: what else the class holds: fields, private names, accessors, static blocks.
function f() {
  return 0;
}
const g = { x: 1, l: [] };
class C2 {}
var p = 1;
function column(A) {
  const given = { __proto__: A.prototype };
  const B = new Proxy(A, { get: (t, k) => (k === "prototype" ? given : t[k]) });
  try {
    new B();
  } catch (error) {
    console.log(error.stack.split("\n").find(line => line.includes("new A")).replace(/.*[\\/]/, ""));
  }
}
column(class A { x = g.x; constructor() { f(); } });
column(class A { x = 1; constructor() { f(); } });
column(class A { #x = 1; constructor() { f(); } });
column(class A { static s = 1; constructor() { f(); } });
column(class A { #p; constructor(a) { this.#p = a; } });
column(class A { #p = 1; constructor(a) { this.#p = a; } });
column(class A { #m() {} constructor(a) { this.#m(); } });
column(class A { #m() {} constructor(a) { f(); } });
column(class A { static #s = 1; constructor(a) { A.#s; } });
column(class A { x; constructor(a) { f(); } });
column(class A { x; y = 2; constructor(a) { this.x = a; } });
column(class A { x = f(); });
column(class A { x = 1; });
column(class A { x; });
column(class A { });
column(class A { m() {} });
column(class A { static x = 1; });
column(class A { static { f(); } constructor(a) { f(); } });
column(class A { get x() { return 1; } constructor(a) { this.y = a; } });
column(class A { #m() {} constructor(a) { this.#m; f(); } });
column(class A { get #g() { return 1; } constructor(a) { this.#g; f(); } });
column(class A { set #g(v) {} constructor(a) { this.#g = a; f(); } });
column(class A { static #s() {} constructor(a) { A.#s(); } });
column(class A { #m() {} constructor(a) { #m in this; f(); } });
column(class A { #m() {} constructor(a) { this.t = #m in a; f(); } });
column(class A { #m() {} constructor(a) { a.#m(); } });
column(class A { accessor x = 1; constructor(a) { f(); } });
column(class A { static accessor x = 1; constructor(a) { f(); } });
column(class A { "constructor"(a) { f(); } });
column(class A { ["constructor"](a) { f(); } });
column(class A { static constructor(a) { f(); } });
column(class A { m() {} constructor(a) { f(); } n() {} });
