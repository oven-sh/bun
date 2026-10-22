// A store that runs only a setter of the class, until something makes it define an own property.
function id(x) { return x; }
function chain(x) { return id(id(id(id(id(id(id(id(x)))))))); }
function show(...parts) { console.log(parts.map(String).join(" | ")); }
function own(o) { return Object.getOwnPropertyNames(o).join(","); }

// 1: the setter is deleted late
{
  class C { set x(v) { this.seen = v; } }
  function store(o, v) { o.x = v; }
  const a = new C(); store(a, 1);
  show("1a", own(a), a.x, a.seen);
  function remove(p) { delete p.x; }
  remove(chain(C.prototype));
  const b = new C(); store(b, 2);
  show("1b", own(b), b.x + 1, b.seen);
}
// 2: the setter is replaced by a writable data property
{
  class C { set x(v) { this.seen = v; } set other(v) {} }
  function store(o, v) { o.x = v; }
  Object.defineProperty(C.prototype, "other", { value: 0, writable: true });
  const a = new C(); store(a, 1);
  show("2a", own(a), a.x, a.seen);
  function replace(p) { Object.defineProperty(p, "x", { value: "data", writable: true, configurable: true }); }
  replace(chain(C.prototype));
  const b = new C(); show("2b", b.x.length); store(b, 2);
  show("2c", own(b), b.x + 1, b.seen);
}
// 3: an own data property on the instance
{
  class C { set x(v) { this.seen = v; } get x() { return "getter"; } }
  function store(o, v) { o.x = v; }
  const a = new C(); store(a, 1);
  show("3a", own(a), a.x, a.seen);
  function shadow(o) { Object.defineProperty(o, "x", { value: 0, writable: true, enumerable: true, configurable: true }); }
  const b = new C(); shadow(chain(b)); store(b, 2);
  show("3b", own(b), b.x + 1, b.seen);
}
// 4: the prototype of the instance changes
{
  class C { set x(v) { this.seen = v; } }
  function store(o, v) { o.x = v; }
  const a = new C(); store(a, 1);
  show("4a", own(a), a.seen);
  const b = new C(); Object.setPrototypeOf(chain(b), chain({ plain: true })); store(b, 2);
  show("4b", own(b), b.x + 1, b.seen, b.plain);
}
// 5: a definition under a key that nobody can name, on the instance
{
  class C { set x(v) { this.seen = v; } }
  function store(o, v) { o.x = v; }
  const a = new C(); store(a, 1);
  show("5a", own(a), a.seen);
  const key = "xyz".slice(0, 1);
  const b = new C(); Object.defineProperty(chain(b), key, { value: 0, writable: true, enumerable: true }); store(b, 2);
  show("5b", own(b), b.x + 1, b.seen);
}
// 6: a data property in the middle of the chain hides the setter
{
  class Base { set x(v) { this.seen = v; } }
  class Mid extends Base {}
  class Leaf extends Mid {}
  function store(o, v) { o.x = v; }
  const a = new Leaf(); store(a, 1);
  show("6a", own(a), a.seen);
  function hide(p) { Object.defineProperty(p, "x", { value: "mid", writable: true, configurable: true }); }
  hide(chain(Mid.prototype));
  const b = new Leaf(); store(b, 2);
  show("6b", own(b), b.x + 1, b.seen);
}
// 7: deleted under a key nobody can name
{
  class C { set x(v) { this.seen = v; } }
  function store(o, v) { o.x = v; }
  const a = new C(); store(a, 1);
  const key = "xyz".slice(0, 1);
  function remove(p, k) { delete p[k]; }
  remove(chain(C.prototype), key);
  const b = new C(); store(b, 2);
  show("7", own(a), own(b), b.x + 1, b.seen);
}
// 8: deleted through a receiver that nobody tracks
{
  class C { set x(v) { this.seen = v; } }
  function store(o, v) { o.x = v; }
  const a = new C(); store(a, 1);
  globalThis.lostBox = C.prototype;
  const unknown = globalThis.lostBox;
  delete unknown.x;
  const b = new C(); store(b, 2);
  show("8", own(a), own(b), b.x + 1, b.seen);
}
