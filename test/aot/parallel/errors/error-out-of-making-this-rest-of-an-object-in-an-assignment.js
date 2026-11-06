// Making `this` has no position of its own: an error out of reading the prototype of new.target is reported at the first position that the constructor records.
// Here: the rest of an object in an assignment, whose copy is recorded at the `{` of the pattern behind the object and the key of its target, and patterns in the head of for-in.
function f() {
  return 0;
}
const g = { x: 1, l: [] };
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
column(class A { constructor(a) { ({ ...p } = {}); } });
column(class A { constructor(a) { ({...p} = {}); } });
column(class A { constructor(a) { (   { ...p } = {}); } });
column(class A { constructor(a) { ({ ...a } = {}); } });
column(class A { constructor(a) { ({ ...a } = {}); f(); } });
column(class A { constructor(a) { let q; ({ ...q } = {}); f(); } });
column(class A { constructor(a) { ({ x: a, ...p } = {}); } });
column(class A { constructor(a) { let q; ({ x: a, ...q } = {}); f(); } });
column(class A { constructor(a) { ({ x: a = f(), ...p } = {}); } });
column(class A { constructor(a) { ({ [f()]: a, ...p } = {}); } });
column(class A { constructor(a) { ({ [a]: a, ...p } = {}); } });
column(class A { constructor(a) { ({ ...this.r } = {}); } });
column(class A { constructor(a) { ({ ...this.rrrr } = {}); } });
column(class A { constructor(a) { ({ ...this[0] } = {}); } });
column(class A { constructor(a) { ({ ...this[a] } = {}); } });
column(class A { constructor(a) { ({ ...this[p] } = {}); } });
column(class A { constructor(a) { ({ ...a.r } = {}); } });
column(class A { constructor(a) { ({ ...a[0] } = {}); } });
column(class A { constructor(a) { ({ ...g.x } = {}); } });
column(class A { constructor(a) { ({ ...f().x } = {}); } });
column(class A { constructor(a) { ({ ...a.b.c } = {}); } });
column(class A { constructor(a) { ({ ...this.r } = a); } });
column(class A { constructor(a) { ({ ...this.r } = p); } });
column(class A { constructor(a) { ({ x: this.x, ...this.r } = a); } });
column(class A { constructor(a) { ({ x: a, ...this.r } = a); } });
column(class A { constructor(a) { ({ x: { ...p } } = { x: {} }); } });
column(class A { constructor(a) { ({ x: { ...a } } = { x: {} }); } });
column(class A { constructor(a) { ({ x: [a] } = { x: [] }); } });
column(class A { constructor(a) { [{ ...a }] = [{}]; } });
column(class A { constructor(a) { for ({ ...p } in {}) {} } });
column(class A { constructor(a) { for ({ ...a } in {}) {} } });
column(class A { constructor(a) { for ({ x: a } in {}) {} } });
column(class A { constructor(a) { for ({ x: p } in {}) {} } });
column(class A { constructor(a) { for ({ x: this.x } in {}) {} } });
column(class A { constructor(a) { for ({} in {}) {} } });
column(class A { constructor(a) { for ([] in {}) {} } });
column(class A { constructor(a) { for ([p] in {}) {} } });
column(class A { constructor(a) { for ([a] in {}) {} } });
column(class A { constructor(a) { for ([this.x] in {}) {} } });
column(class A { constructor(a) { for ({ x: a } in a) {} } });
column(class A { constructor(a) { for ([a] in p) {} } });
column(class A { constructor(a) { for ({ x: a } of a) {} } });
column(class A { constructor(a) { ({ x: a.r } = {}); } });
column(class A { constructor(a) { ({ x: a[0] } = {}); } });
column(class A { constructor(a) { [a.r] = [1]; } });
column(class A { constructor(a) { a.r = 1; } });
column(class A { constructor(a) { ({ ...a.rrrr } = {}); } });
column(class A { constructor(aaaa) { ({ ...aaaa.r } = {}); } });
column(class A { constructor(aaaa) { ({ ...aaaa[0] } = {}); } });
column(class A { constructor(a) { ({ ...(a).r } = {}); } });
column(class A { constructor(a) { ({ ...(this).r } = {}); } });
column(class A { constructor(a) { let t = this; ({ ...t.r } = {}); } });
column(class A { constructor(a) { ({ x: a, ...a.r } = {}); } });
column(class A { constructor(a) { ({ x: a, ...this.r } = {}); } });
column(class A { constructor(a) { ({ ...a.r } = a); } });
column(class A { constructor(a) { ({ ...new.target.r } = {}); } });
column(class A { constructor(a) { ({ ...super.r } = {}); } });
column(class A { constructor(a) { ({ ...arguments[0] } = {}); } });
