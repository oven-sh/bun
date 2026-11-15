// Flags: --aot-harden=proof-checks
// Nobody makes an object that the loops step through. What a step reads is a join behind a try, or comes over the edge of a handler.
let count = 0;
function Base(next) { this.next = next; this.flags = 0; }
function Heir(next) { Base.call(this, next); }
function inherit(heir, base) { function Link() {} Link.prototype = base.prototype; heir.prototype = new Link(); }
(function () { var Local = Base; Local.prototype.mark = function () { count++; return this.flags; }; Local.prototype.step = function () { count = this.flags; return this.next.next; }; Local.prototype.last = function () { this.flags += 2; return 5; }; })();
inherit(Heir, Base);
function behindTry(x, other) { let s = 0, turns = 0, w = 0; let y = x; for (let j = 0; j < 3; j++) { try { for (; y; ) { y.flags = 3; y = s > 2 ? y.next : y.step(); if (w++ === 2) throw -1; if (++turns > 9) break; } } catch (e) { s++; } y = y ? y.next : null; } return s; }
function inHandler(x, other) { let s = 0, turns = 0, w = 0; let y = x; while (turns < 4) { turns++; try { if (y) { s += y.mark(); y = y.next; if (w++ === 2) throw -1; } } catch (e) { s++; y = y && y.next; } } return s; }
function aroundTry(x, other) { let s = 0, turns = 0; let y = x; for (let j = 0; j < 3; j++) { try { for (; y; ) { s += y.mark() * 2 + y.last(); y = y && y.next; if (++turns > 9) break; } } catch (e) { y = y ? y.next : null; } if (y) s += y.flags; } return s; }
let none = null;
function attempt(run) { try { console.log(run()); } catch (e) { console.log(e.name); } }
attempt(() => delete Heir.prototype.mark);
for (let k = 0; k < 3; k++) { attempt(() => behindTry(none, none)); attempt(() => inHandler(none, undefined)); attempt(() => aroundTry(none, none)); }
console.log(count);
