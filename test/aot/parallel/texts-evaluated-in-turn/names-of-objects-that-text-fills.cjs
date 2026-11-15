// for (k in o) of text that is evaluated at run time, over objects that gain, lose and change names before, between and while they are walked. The names of an object that does not change are listed once.
const hidden = t => [t, "0"][process.argv.length > 90 ? 1 : 0], F = (...a) => new Function(...a.slice(0, -1), hidden(a[a.length - 1]));
const lines = [];
const walk = F("o", "let s = ''; for (const k in o) s += k + '=' + o[k] + ' '; return s;");
const makes = {
  literal: F("return { a: 1, b: 2, c: 3 };"), filled: F("const o = {}; for (let i = 0; i < 9; i++) o['k' + i] = i; return o;"), "by name": F("const o = {}; o.x = 1; o.y = 2; o.z = 3; return o;"), emptied: F("const o = { a: 1, b: 2 }; delete o.a; delete o.b; return o;"), "lost one": F("const o = { a: 1, b: 2, c: 3 }; delete o.b; return o;"), "lost and gained": F("const o = { a: 1, b: 2, c: 3 }; delete o.b; o.d = 4; delete o.a; o.b = 5; return o;"),
  numbers: F("return { 2: 'two', 1: 'one', a: 'a' };"), "no prototype": F("const o = Object.create(null); o.p = 1; o.q = 2; return o;"), heir: F("const o = Object.create({ up: 1, a: 'above' }); o.a = 1; o.b = 2; return o;"), instance: F("class A { constructor() { this.x = 1; this.y = 2; } m() {} } return new A();"), hidden: F("const o = { a: 1, b: 2 }; Object.defineProperty(o, 'h', { value: 3, enumerable: false }); o.c = 4; return o;"), getter: F("const o = { a: 1, get b() { return 'got'; } }; o.c = 3; return o;"), frozen: F("return Object.freeze({ a: 1, b: 2 });"), list: F("const l = ['x', 'y']; l.name = 'n'; return l;"), symbol: F("const o = { a: 1 }; o[Symbol.iterator] = 2; o.b = 3; return o;"), many: F("const o = {}; for (let i = 0; i < 80; i++) o['m' + i] = i; return o;"),
};
for (const [name, make] of Object.entries(makes)) {
  const o = make(), seen = [walk(o), walk(o), walk(o)];
  if (Object.isExtensible(o)) { o.late = "l"; seen.push(walk(o), walk(o)); delete o.late; seen.push(walk(o)); for (let i = 0; i < 4; i++) { o["n" + i] = i; seen.push(walk(o)); if (i & 1) delete o["n" + (i - 1)]; } o.a = "changed"; seen.push(walk(o), walk(o)); }
  lines.push(name + ": " + [...new Set(seen)].join("| ").slice(0, 900) + " " + seen.map(s => seen.indexOf(s)));
}
const changing = { "adds while it walks": "for (const k in o) { s += k; if (s.length < 20) o['w' + s.length] = 1; }", "deletes what is next": "for (const k in o) { s += k; delete o.c; }", "deletes what it has": "for (const k in o) { s += k; delete o[k]; }", "changes the prototype": "for (const k in o) { s += k; Object.setPrototypeOf(o, { z: 1 }); }", "walks inside": "for (const k in o) for (const j in o) s += k + j;", "leaves early": "for (const k in o) { if (k === 'b') break; s += k; }", "asks whether it owns": "for (const k in o) if (o.hasOwnProperty(k) && k in o) s += k + o[k];" };
for (const [name, body] of Object.entries(changing)) { const f = F("o", "let s = ''; " + body + " return s;"), o = makes.literal(), seen = []; for (let i = 0; i < 4; i++) seen.push(f(i < 2 ? o : makes.literal()) + " " + Object.keys(o)); lines.push(name + ": " + seen.join("| ")); }
{ // an object that has been walked is no dictionary that each walk lists anew. No other object has its names.
  const { describe } = require("bun:jsc"), f = F("o", "let n = 0; for (const k in o) n++; return n;");
  const once = { literal: "return { apple: 1, pear: 2, plum: 3 };", "by name": "const o = {}; o.oak = 1; o.elm = 2; o.ash = 3; return o;", "by key": "const o = {}; for (const k of ['iron', 'zinc', 'lead', 'gold']) o[k] = k; return o;", instance: "class A { constructor() { this.north = 1; this.south = 2; } } return new A();" };
  for (const [name, body] of Object.entries(once)) { const o = F(body)(); lines.push(name + " walked: " + f(o) + f(o) + " " + /Dictionary/.test(describe(o))); }
}
console.log(lines.join("\n"));
