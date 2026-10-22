// Objects that escape and come back as a value nobody tracks: stores, deletes and definitions through it, before and after the escape.
function id(x) { return x; }
function chain(x) { return id(id(id(id(id(id(id(id(x)))))))); }
function show(...parts) { let text = ""; for (let i = 0; i < parts.length; i++) text += (i ? " | " : "") + String(parts[i]); console.log(text); }
function dynamic(text) { return (text + "!").slice(0, text.length); }
function lose(o) { globalThis.lostValue = o; return globalThis.lostValue; }
// 1: escape first, store through the unknown value later
{ const o = { x: 1 }; function r(v) { return v.x; } show("1a", r(o) + 1); const u = lose(o); u.x = "text"; show("1b", r(o).length); }
// 2: the store through an unknown value is seen first, the object escapes later
{ function w(v) { v.x = "text"; } const first = lose({ x: 0 }); w(first); const o = { x: 1 }; function r(v) { return v.x; } show("2a", r(o) + 1); w(lose(chain(o))); show("2b", r(o).length); }
// 3: a new name through the unknown value
{ const o = { x: 1 }; function r(v) { return v.fresh; } show("3a", r(o)); lose(o).fresh = [1]; show("3b", r(o).length); }
// 4: a key nobody can name through the unknown value
{ const o = { x: 1 }; function r(v) { return v.x; } show("4a", r(o) + 1); lose(o)[dynamic("x")] = "text"; show("4b", r(o).length); }
// 5: a getter and a setter defined through the unknown value
{ const log = []; const o = { x: 1 }; function r(v) { return v.y; } function w(v, x) { v.y = x; } show("5a", r(o));
  Object.defineProperty(lose(o), "y", { get() { return "getter"; }, set(x) { log.push(x); }, configurable: true }); show("5b", r(o).length); w(o, 3); show("5c", log.join(), Object.keys(o).join()); }
// 6: the prototype changes through the unknown value
{ const o = { x: 1 }; function r(v) { return v.above; } show("6a", r(o)); Object.setPrototypeOf(lose(o), { above: "link" }); show("6b", r(o).length); }
// 7: the prototype object escapes, the receiver does not
{ const proto = { m: 1 }; const o = Object.create(proto); function r(v) { return v.m; } show("7a", r(o) + 1); lose(proto).m = "text"; show("7b", r(o).length); delete lose(proto).m; show("7c", r(o)); }
// 8: an element of an escaped list
{ const list = [1, 2]; function r(v) { return v[0]; } show("8a", r(list) + 1); lose(list)[0] = "text"; show("8b", r(list).length); lose(list).length = 0; show("8c", r(list), list.length); }
// 9: reads through the unknown value find what the program stores later
{ const o = { x: 1 }; const u = lose(o); function r(v) { return v.x; } show("9a", r(u) + 1); chain(o).x = "text"; show("9b", r(u).length); chain(o).late = () => "called"; show("9c", u.late()); }
// 10: methods of built-in classes through the unknown value, after the method itself escaped
{ const u = lose([3, 1, 2]); const push = lose(Array.prototype.push); show("10a", typeof push); u.push(0); show("10b", u.length, u.indexOf(0), u.slice(1).length, u.join("")); }
// 11: a class instance escapes: methods, accessors and fields through the unknown value
{ class C { constructor() { this.f = 1; } get g() { return this.f + 1; } set g(v) { this.f = v; } m() { return this.f; } } const o = new C(); const u = lose(o);
  u.g = 10; show("11a", o.f + 1, u.m() + 1, u.g + 1); u.f = "text"; show("11b", o.f.length, o.m().length, o.g); }
// 12: a closure escapes and is called with something else
{ function f(v) { return typeof v; } show("12a", f(1)); show("12b", lose(f)("text"), lose(f)()); }
