// Making `this` has no position of its own: an error out of reading the prototype of new.target is reported at the first position that the constructor records.
// With a direct eval every variable of the constructor lives in a scope.
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
column(class A { constructor(a) { eval("1"); } });
column(class A { constructor(a) { a; eval("1"); } });
column(class A { constructor(a) { this.x = a; eval("1"); } });
column(class A { constructor(a) { this.t = arguments.length; eval("1"); } });
