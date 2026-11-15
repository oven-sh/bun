// records whose fields begin as small integers and become fractions, large, missing, texts or big on later turns
'use strict';
class Meter {
  total = 0; n = 0; last; low = 2147483647; high = -2147483648; flags = 0; label = null;
  add(x) { this.n++; this.last = x; this.total += x; if (x < this.low) this.low = x; if (x > this.high) this.high = x; this.flags |= x; return this; }
  get mean() { return this.total / this.n; }
  scale(k) { this.total *= k; this.low *= k; this.high = this.high * k; return this; }
  step() { this.n += 1; this.total -= 1; return this.n++ + ++this.n; }
  reset() { this.total = this.n = 0; this.last = undefined; return this; }
}
class Wide extends Meter { extra = -1; add(x) { super.add(x); this.extra = this.extra * 2 + 1; return this; } wrap() { return Math.imul(this.total, this.n) | 0; } }
function Old(a, b) { this.a = a | 0; this.b = b; this.c = this.a + this.b; }
Old.prototype.next = function () { this.a = (this.a + 1) | 0; this.b = this.b + this.a; this.c = this.a * this.b; return this.c; };
Old.prototype.mark = function (k, v) { if (this[k] === undefined) this[k] = 0; this[k] += v; return this[k]; };
Old.zero = new Old(0, 0);
function sum(list, key) { var s = 0; for (var i = 0; i < list.length; i++) s += list[i][key]; return s; }
module.exports = { Meter: Meter, Wide: Wide, Old: Old, sum: sum };
