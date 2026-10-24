// What changes a lookup is reached only through a value that the analysis gets after its first pass has come to rest: a field read through a leak of this before its store.
function show(...parts) { let text = ""; for (let i = 0; i < parts.length; i++) text += (i ? " | " : "") + String(parts[i]); console.log(text); }
function nothing() {}
function lateOf(late) {
  let leaked, seen;
  class Leaky { constructor() { leaked = this; seen = leaked.k; this.k = "a"; } }
  new Leaky();
  return { a: nothing, undefined: late }[seen];
}
// 1: a setter on the grandparent
{ const log = []; const top = {}, middle = Object.create(top), bottom = Object.create(middle); function w(o, v) { o.x = v; } w(Object.create(middle), 0);
  lateOf(() => { Object.defineProperty(top, "x", { set(v) { log.push(v); this.kept = v; } }); })(); w(bottom, 1); show("1", Object.keys(bottom).join(), bottom.kept + 1, log.join()); }
// 2: a getter on the grandparent
{ const top = {}, middle = Object.create(top), bottom = Object.create(middle); function r(o) { return o.x; } show("2a", r(bottom));
  lateOf(() => { Object.defineProperty(top, "x", { get() { return "getter"; } }); })(); show("2b", r(bottom).length); }
// 3: a new link
{ const top = {}, bottom = Object.create(top); function r(o) { return o.x; } show("3a", r(bottom)); lateOf(() => { Object.setPrototypeOf(top, { x: "linked" }); })(); show("3b", r(bottom).length); }
// 4: a field is deleted
{ const o = { __proto__: { x: "above" }, x: 1 }; function r(v) { return v.x; } show("4a", r(o) + 1); lateOf(() => { delete o.x; })(); show("4b", r(o).length); }
// 5: another key
{ const o = { a: 1, b: "text" }; let key = "a"; function r() { return o[key]; } show("5a", r() + 1); lateOf(() => { key = "b"; })(); show("5b", r().length); }
// 6: a store under a key nobody can name
{ const o = { a: 1 }; function r(v) { return v.a; } show("6a", r(o) + 1); lateOf(() => { o["ab".slice(0, 1)] = "text"; })(); show("6b", r(o).length); }
// 7: the setter of a class goes away
{ class C { set x(v) { this.kept = v; } } function w(o, v) { o.x = v; } const a = new C(); w(a, 1); lateOf(() => { delete C.prototype.x; })(); const b = new C(); w(b, 2); show("7", Object.keys(a).join(), Object.keys(b).join(), b.x + 1); }
// 8: a descriptor
{ const o = {}; let d; function define() { try { Object.defineProperty(o, "x", d); } catch (e) {} } define(); lateOf(() => { d = { get() { return "getter"; } }; })(); define(); show("8", o.x.length); }
// 9: the source of a copy grows
{ const source = { a: 1 }; function copy() { return { ...source }; } show("9a", copy().late); lateOf(() => { source.late = "text"; })(); show("9b", copy().late.length); }
// 10: the object escapes and is changed through what comes back
{ const o = { x: 1 }; function r(v) { return v.x; } show("10a", r(o) + 1); lateOf(() => { globalThis.lostValueLate = o; globalThis.lostValueLate.x = "text"; })(); show("10b", r(o).length); }
// 11: a member on the prototype of numbers
{ function r(v) { return v.lateMember; } show("11a", r(5)); lateOf(() => { Number.prototype.lateMember = "text"; })(); show("11b", r(5).length); delete Number.prototype.lateMember; }
// 12: a store in a constructor that is found late, before a read of this
{ let fill = nothing; class C { constructor() { fill(this); this.seen = this.m; } } C.prototype.m = "proto"; show("12a", new C().seen.length); lateOf(() => { fill = (o) => { o.m = 1; }; })(); show("12b", new C().seen + 1); }
