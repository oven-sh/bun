// A test of a field of `a` holds across a callee that writes the field of that name through `b`, an object of another class; the build verifies each pass.
class Base {
  v: number; w: number;
  constructor(v: number) { this.v = v; this.w = 0 }
  step(n: number): number {
    this.v = (this.v * 3 + n) | 0; this.w = (this.w * 5 + this.v) | 0; this.v = (this.v ^ this.w) | 0; this.w = (this.w * 7 + this.v) | 0;
    this.v = (this.v * 11 + n) | 0; this.w = (this.w * 13 + this.v) | 0; this.v = (this.v ^ this.w) | 0; this.w = (this.w * 17 + this.v) | 0;
    this.v = (this.v * 19 + n) | 0; this.w = (this.w * 23 + this.v) | 0; this.v = (this.v ^ this.w) | 0; this.w = (this.w * 29 + this.v) | 0;
    this.v = (this.v * 31 + n) | 0; this.w = (this.w * 37 + this.v) | 0; this.v = (this.v ^ this.w) | 0; this.w = (this.w * 41 + this.v) | 0;
    return this.v;
  }
}
class Derived extends Base {
  step(n: number): number {
    const first = super.step(n); const second = super.step(first);
    this.w = (this.w * 43 + first) | 0; this.v = (this.v ^ second) | 0; this.w = (this.w * 47 + this.v) | 0; this.v = (this.v * 53 + this.w) | 0;
    this.w = (this.w * 59 + first) | 0; this.v = (this.v ^ second) | 0; this.w = (this.w * 61 + this.v) | 0; this.v = (this.v * 67 + this.w) | 0;
    this.w = (this.w * 71 + first) | 0; this.v = (this.v ^ second) | 0; this.w = (this.w * 73 + this.v) | 0; this.v = (this.v * 79 + this.w) | 0;
    return this.v;
  }
}
class Alone {
  v: number; w: number;
  constructor(v: number) { this.v = v; this.w = 0 }
  step(n: number): number {
    const first = stepOf(this, n); const second = stepOf(this, first);
    this.w = (this.w * 43 + first) | 0; this.v = (this.v ^ second) | 0; this.w = (this.w * 47 + this.v) | 0; this.v = (this.v * 53 + this.w) | 0;
    this.w = (this.w * 59 + first) | 0; this.v = (this.v ^ second) | 0; this.w = (this.w * 61 + this.v) | 0; this.v = (this.v * 67 + this.w) | 0;
    this.w = (this.w * 71 + first) | 0; this.v = (this.v ^ second) | 0; this.w = (this.w * 73 + this.v) | 0; this.v = (this.v * 79 + this.w) | 0;
    return this.v;
  }
}
function stepOf(t: Alone, n: number): number {
  t.v = (t.v * 3 + n) | 0; t.w = (t.w * 5 + t.v) | 0; t.v = (t.v ^ t.w) | 0; t.w = (t.w * 7 + t.v) | 0;
  t.v = (t.v * 11 + n) | 0; t.w = (t.w * 13 + t.v) | 0; t.v = (t.v ^ t.w) | 0; t.w = (t.w * 17 + t.v) | 0;
  t.v = (t.v * 19 + n) | 0; t.w = (t.w * 23 + t.v) | 0; t.v = (t.v ^ t.w) | 0; t.w = (t.w * 29 + t.v) | 0;
  t.v = (t.v * 31 + n) | 0; t.w = (t.w * 37 + t.v) | 0; t.v = (t.v ^ t.w) | 0; t.w = (t.w * 41 + t.v) | 0;
  return t.v;
}
function across(a: Derived, b: Alone, n: number): number { const x = a.w; stepOf(b, n); return x + a.w }
function acrossAgain(a: Derived, b: Alone, n: number): number { const x = a.w; stepOf(b, n + 1); return x - a.w }
function acrossSame(a: Alone, b: Alone, n: number): number { const x = a.w; stepOf(b, n); return x + a.w }

const many: Derived[] = [new Derived(1), new Derived(2)];
const others: Alone[] = [new Alone(1), new Alone(2)];
let total = 0;
for (let i = 0; i < 30000; i++) {
  const a = many[i & 1], b = others[i & 1];
  total = (total + across(a, b, i) + acrossAgain(a, b, i) + acrossSame(others[(i + 1) & 1], b, i) + acrossSame(b, b, i)) | 0;
  if ((i & 1023) === 0) total = (total + a.step(i) + b.step(i)) | 0;
}
console.log(total);
