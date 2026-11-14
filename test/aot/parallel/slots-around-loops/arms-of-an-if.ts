// A field that comes round a loop and that one arm of an if stores is a parameter where the arms meet: each arm's value is seen behind it.
// STATISTIC: CarriedSlotsMergedAtJoins >= 4
const bytes = new Uint8Array(24);
for (let i = 0; i < 24; i++) bytes[i] = (i * 37) & 63;
const text = "ab 12 (c+d) 345 e";

class Scanner {
  at = 0;
  words = 0;
  digits = 0;
  others = 0;
  depth = 0;
  most = -1;
  low = 1e9;
  scan(): string {
    while (this.at < text.length) {
      const c = text.charCodeAt(this.at);
      if (c === 32) { this.at++; } else if (c > 96) { this.at++; this.words++; } else if (c > 47 && c < 58) { this.at += 1; this.digits++; } else { this.others++; this.at++; }
    }
    return `${this.words} ${this.digits} ${this.others}`;
  }
  nest(count: number): number { for (let k = 0; k < count; k++) { if (bytes[k] & 1) { this.depth++; if (this.depth > this.most) this.most = this.depth; } else if (this.depth > 0) this.depth--; } return this.most; }
  range(count: number): string { for (let k = 0; k < count; k++) { const v = bytes[k]; if (v < this.low) this.low = v; if (v > this.most) this.most = v; } return `${this.low} ${this.most}`; }
  skips(count: number): number { let sum = 0; while (this.at < count) { sum = (sum + bytes[this.at]) | 0; if (bytes[this.at] & 2) this.at += 2; else this.at++; } return sum; }
}
function odd(o: Scanner, count: number): string { for (let k = 0; k < count; k++) { if (bytes[k] & 1) o.words++; else o.digits += k; } return `${o.words} ${o.digits}`; }
function aliased(o: Scanner, other: Scanner, count: number): string { for (let k = 0; k < count; k++) { if (k & 1) o.at++; else other.at += 5; o.others += o.at; } return `${o.at} ${o.others}`; }
function fractions(o: Scanner, count: number): string { for (let k = 0; k < count; k++) { if (k === 3) o.at = 0.5; else o.at++; o.words += o.at; } return `${o.at} ${o.words}`; }
function left(o: Scanner, count: number): string { for (let k = 0; k < count; k++) { o.at++; if (o.at === 4) { o.words = 7; break; } if (k & 1) { o.digits++; continue; } o.others++; } return `${o.at} ${o.words} ${o.digits} ${o.others}`; }
function chosen(o: Scanner, count: number): string { for (let k = 0; k < count; k++) { o.at = k & 2 ? o.at + 3 : o.at - 1; switch (k % 3) { case 0: o.words++; break; case 1: o.words += 2; break; default: o.digits = o.words; } } return `${o.at} ${o.words} ${o.digits}`; }
function nested(o: Scanner, count: number): string { for (let j = 0; j < 3; j++) { if (j === 1) o.at = 10; for (let k = 0; k < count; k++) { if (k & j) o.at++; else o.words += o.at; } } return `${o.at} ${o.words}`; }
function thrown(o: Scanner, count: number): string { for (let k = 0; k < count; k++) { try { if (k & 1) o.at++; if (k === 3) throw k; o.words += o.at; } catch { o.at = -o.at; } } return `${o.at} ${o.words}`; }
function both(a: Scanner, b: Scanner, count: number): string { for (let k = 0; k < count; k++) { if (k % 3) a.at += 2; else b.at += a.at; } return `${a.at} ${b.at}`; }

const first = new Scanner(), second = new Scanner();
function again(start: number): void { first.at = second.at = start; first.words = second.words = 0; first.digits = second.digits = 0; first.others = second.others = 0; first.depth = 0; first.most = -1; first.low = 1e9; }
function show(name: string, answer: string | number): void { console.log(name, answer, Object.is(first.at, -0) ? "-0" : first.at, first.words, first.digits, first.others, second.at); }
again(0); show("scan", first.scan());
again(3); show("scan", first.scan());
again(0); show("nest", first.nest(24));
again(0); show("range", first.range(24));
again(0); show("range", first.range(0));
again(0); show("skips", first.skips(20));
again(2147483640); show("skips", first.skips(2147483660));
again(0); show("odd", odd(first, 24));
again(1); show("aliased", aliased(first, second, 9));
again(1); show("aliased to itself", aliased(first, first, 9));
again(2147483644); show("fractions", fractions(first, 9));
again(0); show("left", left(first, 9));
again(-0); show("chosen", chosen(first, 10));
again(2147483647); show("chosen", chosen(first, 10));
again(0); show("nested", nested(first, 6));
again(0); show("thrown", thrown(first, 7));
again(5); show("both", both(first, second, 8));
again(5); show("both itself", both(first, first, 8));
