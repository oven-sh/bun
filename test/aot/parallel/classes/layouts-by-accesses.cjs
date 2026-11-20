// A class with more fields than its parent, which unseen code passes: the parent's methods access its fields in loops, so its objects have the parent's layout. Where the methods of the class do, they have its own.
// COUNTER: DynamicSubclassInstances >= 6
"use strict";
globalThis.pass = (value, to) => to(value);
const pass = globalThis.pass, out = [];
function Cursor(text) { this.text = text; this.pos = 0; this.end = 0; }
Cursor.prototype.all = function () { let n = 0; while (this.pos < this.text.length) { if (this.text.charCodeAt(this.pos) === 32) this.end = this.pos; n += this.pos++; } return n + this.end; };
class Reader { constructor(text) { this.text = text; this.pos = 0; } all() { let n = 0; while (this.pos < this.text.length) n += this.text.charCodeAt(this.pos++); return n; } }
const fields = (Base) => class Fields extends Base { a = 1; b = 2; c = 3; d = 4; e = "e"; f = null; sum() { return this.a + this.b + this.c + this.d + this.pos; } };
const loops = (Base) => class Loops extends Base { a = 1; b = 2; c = 3; d = 4; e = 5; f = 6; all2() { let n = 0; for (let i = 0; i < 50; i++) { this.a += this.b; for (let j = 0; j < 4; j++) n += this.a + this.c++ + this.d; } return n; } };
for (const Parent of [Cursor, Reader]) {
  for (const make of [fields, loops]) {
    const Heir = pass(Parent, make);
    let total = 0;
    for (let i = 0; i < 50; i++) { const h = new Heir("alpha beta " + i); total += h.all() + (h.sum ? h.sum() : h.all2()); }
    const h = new Heir("a b c");
    out.push(total, JSON.stringify(h), h.all(), Object.keys(h).join(), h instanceof Parent, JSON.stringify(h));
    h.text = 5; h.pos = "p"; h.e = [1]; h.f = undefined; h.late = h.pos + h.text;
    const keys = []; for (const key in h) keys.push(key);
    out.push(keys.join(), JSON.stringify(h), delete h.pos, "pos" in h, Object.keys(h).join(), h.sum ? h.sum() : h.all2());
    class Below extends Heir { g = 7; a = 10; sum() { return super.sum ? super.sum() + this.g : this.g; } }
    const below = new Below("x y"); out.push(below.all(), below.sum(), JSON.stringify(below));
    out.push(JSON.stringify(Object.assign({}, below)), JSON.stringify({ ...h }), Object.getOwnPropertyNames(below).join());
  }
}
for (const line of out) console.log(String(line));
