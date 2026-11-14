// Digits moved from one list of numbers to another: a list of int32s that takes int32s stays one.
// STATISTIC: MovedNumbersKeepInt32s >= 2
class Digits {
  constructor() { this.list = new Array(); this.count = 0; }
  copyTo(other) { const from = this.list, to = other.list; for (let i = this.count - 1; i >= 0; --i) to[i] = from[i]; other.count = this.count; }
  shiftTo(n, other) { const from = this.list, to = other.list; for (let i = this.count - 1; i >= 0; --i) to[i + n] = from[i]; for (let i = n - 1; i >= 0; --i) to[i] = 0; other.count = this.count + n; }
  dropTo(n, other) { const from = this.list, to = other.list; for (let i = n; i < this.count; ++i) to[i - n] = from[i]; other.count = Math.max(this.count - n, 0); }
  swapTo(other) { const from = this.list, to = other.list; for (let i = 0; i < this.count; i++) { to[i] = from[i]; from[i] = i; } other.count = this.count; }
  sum() { let sum = 0; for (let i = 0; i < this.count; i++) sum += this.list[i] * (i + 1); return sum; }
  show() { let text = this.count + ":"; for (let i = 0; i < this.list.length; i++) text += (i in this.list ? Object.is(this.list[i], -0) ? "-0" : this.list[i] : "_") + ","; return text; }
}
const fills = [(d, n) => { for (let i = 0; i < n; i++) d.list[i] = i * 7919 & 0xfffffff; }, (d, n) => { for (let i = 0; i < n; i++) d.list[i] = i / 4; }, (d, n) => { for (let i = 0; i < n; i++) d.list[i] = i & 1 ? -0 : NaN; },
  (d, n) => { for (let i = 0; i < n; i++) d.list[i] = i === 3 ? 4294967295 : i; }, (d, n) => { for (let i = 0; i < n; i++) if (i % 3) d.list[i] = i; }, (d, n) => { for (let i = n - 1; i >= 0; i--) d.list[i] = i; }, (d, n) => {}];
let digest = 0, cases = 0;
for (const size of [0, 1, 4, 9, 40]) for (let from = 0; from < fills.length; from++) for (let to = 0; to < fills.length; to++) {
  for (const move of [(a, b) => a.copyTo(b), (a, b) => a.shiftTo(3, b), (a, b) => a.dropTo(2, b), (a, b) => a.swapTo(b), (a, b) => { a.copyTo(b); b.shiftTo(1, a); a.dropTo(2, b); }, (a, b) => a.copyTo(a), (a, b) => a.shiftTo(2, a)]) {
    const a = new Digits(), b = new Digits();
    fills[from](a, size); a.count = size;
    fills[to](b, size >> 1); b.count = size >> 1;
    move(a, b);
    const line = a.show() + " " + b.show() + " " + a.sum() + " " + b.sum();
    cases++;
    for (let i = 0; i < line.length; i++) digest = (digest * 31 + line.charCodeAt(i)) | 0;
    if (cases % 97 === 13) console.log(size, from, to, line.slice(0, 150));
  }
}
console.log(cases, digest);
