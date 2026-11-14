// A store into a field that a later store of the same row overwrites, with nothing between that reads it or leaves.
// STATISTIC: OverwrittenSlotStoresDropped >= 4
const turns = JSON.parse("50");
const said = [];
class Link { next = null; constructor(value) { this.value = value; } }
class Chain { head = null; size = 0; add(value) { const link = new Link(value); link.next = this.head; this.head = link; this.size++; return this; } sum() { let sum = 0; for (let link = this.head; link; link = link.next) sum += link.value; return sum * 10 + this.size; } }
function chain(i) { return new Chain().add(1).add(2).add(i & 7).sum(); }
class Point { constructor(x) { this.x = x; this.y = x; } get twice() { said.push("read " + this.x); return this.x * 2; } }
function twice(p, i) { p.x = i; p.y = [i]; p.x = i + 1; p.y = i + 2; return p.x + p.y; }
function read(p, i) { p.x = i; const seen = p.x; p.x = i + 1; return seen + p.x; }
function aliased(p, q, i) { p.x = i; const seen = q.x; p.x = i + 5; return seen * 100 + p.x; }
function getter(p, i) { p.x = i; const seen = p.twice; p.x = i + 1; return seen + p.x; }
function thrown(p, i) { try { p.x = i; if (i % 3 === 0) throw new Error("three"); p.x = -i; } catch (error) { return error.message + p.x; } return p.x; }
function thrownBetween(p, i, o) { try { p.x = i; o.f(); p.x = -i; } catch (error) { return error.name + p.x; } return p.x; }
function keyed(p, i, key) { p.x = i; const seen = p[key]; p.x = i * 2; return seen + p.x; }
function held(p, i) { p.x = { i }; const box = [p]; p.x = box; return box[0].x === box; }
function spread(p, i) { p.x = i; const copy = { ...p }; p.x = 0; return copy.x + p.x; }
function branches(p, i) { p.x = i; if (i % 2) p.x = i + 1; else p.y = 0; p.x = p.x + 1; return p.x; }
const p = new Point(1), q = new Point(2);
for (let i = 0; i < turns; i++)
  said.push([chain(i), twice(p, i), read(p, i), aliased(p, i % 2 ? p : q, i), i < 3 ? getter(p, i) : 0, thrown(p, i), thrownBetween(p, i, i % 2 ? null : { f() {} }), keyed(p, i, i % 2 ? "x" : "y"), held(p, i), spread(p, i), branches(p, i)].join(" "));
let hash = 0; for (const c of said.join("\n")) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) | 0;
console.log(hash, said.length, said.slice(0, 6).join("\n"), said.at(-1));
