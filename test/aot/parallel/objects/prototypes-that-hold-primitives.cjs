'use strict';
// Prototypes of constructor functions hold primitives for names which their objects get only when something is stored: reads before and behind the store, deletes, changed defaults, heirs, names asked for by key, and turns that mix both kinds.
function Box(w) { this.w = w; }
Box.prototype.depth = 0; Box.prototype.mark = null; Box.prototype.title = 'untitled'; Box.prototype.isOpen = false; Box.prototype.scale = 1.5; Box.prototype.later = undefined;
Box.prototype.area = function () { return this.w * this.scale + this.depth; };
Box.prototype.open = function (title) { if (!this.isOpen) { this.isOpen = true; this.title = title; this.depth = this.depth + 1; } return this.title; };
Box.prototype.link = function (to) { const had = this.mark; this.mark = to; return had; };
function Crate(w) { Box.call(this, w); } Crate.prototype = Object.create(Box.prototype, { constructor: { value: Crate, writable: true, configurable: true } }); Crate.prototype.depth = 10;
const keys = o => Object.keys(o).sort().join('.');
function over(boxes) { let s = 0; for (let i = 0; i < boxes.length; i++) { const b = boxes[i]; s += b.area(); if (b.mark !== null) s += b.mark.w; if (b.isOpen) s -= b.title.length; } return s; }
function chain(n) { let head = null; for (let i = 0; i < n; i++) { const b = i % 3 ? new Box(i) : new Crate(i); if (head) b.link(head); head = b; } let s = 0; for (let b = head; b !== null; b = b.mark) s = s * 2 + b.depth + b.w | 0; return s; }
for (let i = 0; i < 100; i++) { over([new Box(i), new Crate(2)]); chain(6); }
const a = new Box(2), b = new Box(3), c = new Crate(4);
console.log(over([a, b, c]), keys(a), chain(9), a.open('first'), a.open('second'), keys(a), over([a, b, c]));
console.log(b.link(a), b.link(c) === a, keys(b), over([a, b, c]), 'mark' in a, Object.hasOwn(a, 'mark'), a.later, 'later' in a);
delete a.title; console.log(a.title, a.isOpen, over([a, b, c])); delete b.mark; console.log(b.mark, over([a, b, c]));
Box.prototype.scale = 2; Box.prototype.title = 'changed'; console.log(over([a, b, c]), new Box(1).title, c.title);
Box.prototype.depth = 'deep'; console.log(new Box(1).area(), c.area(), over([a, c]), a.depth); Box.prototype.depth = 0;
Object.defineProperty(Box.prototype, 'isOpen', { get() { return this.w > 2; }, set(v) { this.w += 10; }, configurable: true });
console.log(new Box(1).open('x'), new Box(5).open('y'), over([new Box(1), new Box(5)]), keys(a));
Object.defineProperty(Box.prototype, 'mark', { value: null, writable: false }); let said; try { new Box(1).link(a); said = 'stored'; } catch (e) { said = e.constructor.name; } console.log(said, b.mark);
for (const k of ['w', 'depth', 'title', 'none']) console.log(k, a[k], k in c, Object.hasOwn(c, k)); Object.setPrototypeOf(Crate.prototype, null); console.log(c.depth, c.scale, typeof c.area);
