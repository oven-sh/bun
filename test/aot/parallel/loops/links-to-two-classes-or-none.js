'use strict';
// A field holds an instance of one of two classes, null, undefined or a text. What it is is asked in loops that go along it, in turns that store into it, and behind the loops.
class Bead { constructor(n, next) { this.n = n; this.next = next; } }
class Knot { constructor(n, next) { this.next = next; this.n = n; this.tied = true; } }
const chain = (n, kinds) => { let head = null; for (let i = n; i--;) head = kinds[i % kinds.length] === 'k' ? new Knot(i, head) : new Bead(i, head); return head; };
function along(head) { let s = 0, at = head; while (at instanceof Bead || at instanceof Knot) { s = s * 3 + at.n | 0; if (at instanceof Knot) s ^= 5; at = at.next; } return s + ':' + (at === null ? 'null' : typeof at); }
function untie(head) { let n = 0; for (let at = head; at; at = at.next) { if (at.next instanceof Knot) { at.next = new Bead(at.next.n + 100, at.next.next); n++; } } return n; }
function cut(head, where, what) { let at = head; for (let i = 0; i < where && at.next; i++) at = at.next; const had = at.next; at.next = what; return had === null ? 'null' : typeof had === 'object' ? had.constructor.name + had.n : String(had); }
function count(head) { let beads = 0, knots = 0, at = head; for (;;) { if (at instanceof Bead) beads++; else if (at instanceof Knot) knots++; else break; at = at.next; } return beads + '/' + knots + '/' + (at === undefined ? 'undefined' : at === null ? 'null' : typeof at === 'string' ? at : 'other'); }
const say = f => { try { return String(f()); } catch (e) { return e.constructor.name; } };
for (let i = 0; i < 100; i++) { const c = chain(20, 'bbkbk'); along(c); untie(c); count(c); }
for (const kinds of ['b', 'k', 'bk', 'bbbk']) { const c = chain(9, kinds); console.log(kinds, along(c), count(c), untie(c), along(c), count(c)); }
for (const what of [undefined, 'end', null, 5, { n: 1, next: null }, new (class extends Knot {})(7, null), Object.create(Bead.prototype), Symbol.iterator, 12n, []]) { const c = chain(12, 'bkk'); console.log(say(() => cut(c, 4, what)), say(() => along(c)), count(c), say(() => untie(c)), say(() => cut(c, 4, null))); }
const c = chain(6, 'bk'); Object.defineProperty(Knot, Symbol.hasInstance, { value: v => v === c }); console.log(along(c), count(c));
