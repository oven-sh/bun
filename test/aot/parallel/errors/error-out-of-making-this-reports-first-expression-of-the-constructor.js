// Making `this` has no position of its own: an error out of reading the prototype of new.target is reported at the first expression of the constructor that records one.
function f() {
  return 0;
}
const g = { x: 1 };
function column(A) {
  const given = { __proto__: A.prototype };
  const B = new Proxy(A, { get: (t, k) => (k === "prototype" ? given : t[k]) });
  try {
    new B();
  } catch (error) {
    console.log(error.stack.split("\n").find(line => line.includes("new A")).replace(/.*[\\/]/, ""));
  }
}
column(class A { constructor() { this.r = typeof this.m; } });
column(class A { constructor() { f(); } });
column(class A { constructor() { const a = 1; const b = f(); } });
column(class A { constructor() { this.items = []; this.count = 0; } });
column(class A { constructor() { this.name = g.x; } });
column(class A { constructor(a) { if (a) { f(); } } });
column(class A { constructor() { return; } });
column(class A { constructor() {} });
