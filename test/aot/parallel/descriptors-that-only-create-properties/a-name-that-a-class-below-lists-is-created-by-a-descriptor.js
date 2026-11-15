"use strict";
// The descriptor creates `tag` on objects of Base; Heir, below it, lists a field of that name.
class Base { constructor(i) { this.kept = i; } }
class Heir extends Base { tag = "own"; constructor(i) { super(i); this.more = i * 2; } }
function mark(object) { Object.defineProperty(object, "tag", { value: "laid" }); }
function tried(run) { try { return run(); } catch (error) { return error.name; } }
const bases = [], heirs = [];
for (let i = 0; i < 30; i++) { bases.push(new Base(i)); heirs.push(new Heir(i)); }
for (const each of bases) mark(each);
function sum(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i].kept + list[i].tag.length + (list[i].absent === undefined ? 1 : 100); return s; }
console.log(sum(bases), sum(heirs), bases[3].tag, heirs[3].tag, Object.keys(bases[3]).join(), Object.keys(heirs[3]).join());
console.log(tried(() => { mark(heirs[0]); return heirs[0].tag; }), tried(() => { heirs[1].tag = "stored"; return heirs[1].tag; }), tried(() => { bases[1].tag = "stored"; return bases[1].tag; }), sum(heirs));
