// Loops that carry objects and leave by side paths: their generic iteration reads fields of what is carried before the side paths lead there.
let calls = 0, notes = [];
const table = {
  fix: (x) => { calls += x.size; notes.length < 5 && notes.push(typeof x.kind); return x; },
  twice(x) { calls += 2; x.size >>= 1; },
};
const names = ["fix", "twice"];
class Amount { constructor(n) { this.size = n; this.last = null; this.kind = n; this.data = [n, 1, 2]; } }
function fresh(n) { return new Amount(n || 0); }
Amount.prototype.multiplyTo = function (y, r) { r.size = (this.size + y.size) & 31; };
Amount.prototype.squareTo = function (r) { r.size = (this.size * 3 + 1) & 31; if (r.size > 9) r.reduce(); };
Amount.prototype.reduce = function () { if (this.size > 12) this.size -= 7; };
Amount.prototype.copyTo = function (r) { r.size = this.size; for (var i = 0; i < this.data.length; ++i) r.data[i] = this.data[i]; };
function Rule(m) { this.m = m; }
Rule.prototype.mulTo = function (x, y, r) { x.multiplyTo(y, r); if (r.size > 9) table[names[calls & 1]](r); };
Rule.prototype.sqrTo = function (x, r) { x.squareTo(r); };
Amount.prototype.power = function power(e, m, n) {
  var z = new Rule(m), r = fresh(1), r2 = fresh(2), t = this, g = [this, m], top = e.size, j = top, i = 4, first = true;
  for (; j >= 0; calls += 0) {
    if (j === top - 2) { g[0].copyTo(r); }
    else {
      if (n > 0) z.sqrTo(r, r2);
      else { r2 = t; }
      z.mulTo(r2, g[(i & 1) ^ 1], r);
    }
    for (let k = 0; k < (j & 3); ++k) { z.mulTo(r, g[i & 1], r2); }
    --j;
    i = 4;
  }
  return r.size * 100 + (r2 ? r2.size : 7);
};
Amount.prototype.rounds = function (n) {
  var sum = 0;
  for (var i = 0; i < n; ++i) {
    var y = this.power(this, fresh(i + 1), n - i - 2);
    sum += y;
  }
  return sum;
};
function search(from, n) {
  var found = [], num = fresh(from);
  do {
    found.push(num.rounds(n));
    num.size++;
  } while (num.size < from + 2);
  return found.join();
}
console.log(search(2, 3), search(5, 2));
console.log(search(3, 3));
console.log(calls, notes.join());
