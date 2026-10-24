// A value and an accessor under one name, defined in either order, where the analysis meets the second one first.
function id(x) { return x; }
function chain(x) { return id(id(id(id(id(id(id(id(x)))))))); }
function show(...parts) { let text = ""; for (let i = 0; i < parts.length; i++) text += (i ? " | " : "") + String(parts[i]); console.log(text); }
function dynamic(text) { return (text + "!").slice(0, text.length); }
// 1: an accessor under a computed name that arrives late, then a value over it
{ const name = chain(chain(chain("x"))); class C { get [name]() { return "getter"; } set [name](v) { this.kept = v; } }
  function r(o) { return o.x; } function w(o, v) { o.x = v; }
  const a = new C(); show("1a", r(a).length); w(a, 1); show("1b", a.kept + 1, Object.keys(a).join());
  Object.defineProperty(C.prototype, "x", { value: 7, writable: true, configurable: true, enumerable: true });
  const b = new C(); show("1c", r(b) + 1); w(b, 2); show("1d", r(b) + 1, b.kept, Object.keys(b).join()); }
// 2: the same on a literal
{ const name = chain(chain(chain("x"))); const o = { get [name]() { return "getter"; } }; function r(v) { return v.x; } show("2a", r(o).length);
  Object.defineProperty(o, "x", { value: 7, writable: true, configurable: true, enumerable: true }); show("2b", r(o) + 1); o.x = "stored"; show("2c", r(o).length); }
// 3: a value first, an accessor over it through a long way, then a store
{ const log = []; const o = { x: 1 }; function r(v) { return v.x; } function w(v, x) { v.x = x; } show("3a", r(o) + 1);
  Object.defineProperty(chain(chain(o)), "x", { get() { return "getter"; }, set(v) { log.push(v); }, configurable: true }); show("3b", r(o).length); w(o, 5); show("3c", r(o).length, log.join()); }
// 4: an accessor on a fresh object, a store that runs its setter, and keys
{ const log = []; const o = {}; Object.defineProperty(o, "x", { get() { return "getter"; }, set(v) { log.push(v); }, enumerable: true, configurable: true });
  o.x = 5; show("4a", o.x.length, log.join(), Object.keys(o).join(), JSON.stringify(o)); delete o.x; o.x = 6; show("4b", o.x + 1, log.join()); }
// 5: a class field defined over an accessor of the base class
{ const log = []; class B { get x() { return "getter"; } set x(v) { log.push(v); } } class C extends B { x = 1; } function r(v) { return v.x; } show("5", r(new C()) + 1, r(new B()).length, log.length); }
// 6: a method replaced by an accessor and back
{ class C { m() { return "method"; } } function call(o) { return o.m(); } const o = new C(); show("6a", call(o).length);
  Object.defineProperty(chain(C.prototype), "m", { get() { return () => 6; }, configurable: true }); show("6b", call(o) + 1);
  Object.defineProperty(chain(C.prototype), "m", { value() { return [1]; }, configurable: true }); show("6c", call(o).length); }
// 7: symbols on parsed data
{ const s = Symbol("s"); const parsed = JSON.parse('{"a":1}'); function r(v) { return v[s]; } show("7a", r(parsed)); parsed[Object.getOwnPropertySymbols({ [s]: 0 })[0]] = "late"; show("7b", r(parsed).length, parsed.a + 1); }
