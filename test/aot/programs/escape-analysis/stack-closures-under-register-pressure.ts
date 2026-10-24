// Stack-allocated closures in functions with many live values.
let noise = 0;
function calls(f: (x: number) => number, x: number): number { if (noise > 1e9) return calls(f, x); return f(x) + f(x + 1); }
function first(n: number): number {
  let t = n;
  const add = (x: number): number => { t += x; return t; };
  return calls(add, 1) + calls(add, 2);
}
function pressure(n: number): number {
  let t = n;
  let u = n + 0.25;
  const i0 = (n * 3 + 1) | 0, i1 = (n * 4 + 8) | 0, i2 = (n * 5 + 15) | 0, i3 = (n * 6 + 22) | 0, i4 = (n * 7 + 29) | 0, i5 = (n * 8 + 36) | 0, i6 = (n * 9 + 43) | 0, i7 = (n * 10 + 50) | 0, i8 = (n * 11 + 57) | 0, i9 = (n * 12 + 64) | 0, i10 = (n * 13 + 71) | 0, i11 = (n * 14 + 78) | 0, i12 = (n * 15 + 85) | 0, i13 = (n * 16 + 92) | 0, i14 = (n * 17 + 99) | 0, i15 = (n * 18 + 106) | 0, i16 = (n * 19 + 113) | 0, i17 = (n * 20 + 120) | 0, i18 = (n * 21 + 127) | 0, i19 = (n * 22 + 134) | 0;
  const d0 = n * 0.1 + 0.5, d1 = n * 0.2 + 1.5, d2 = n * 0.3 + 2.5, d3 = n * 0.4 + 3.5, d4 = n * 0.5 + 4.5, d5 = n * 0.6 + 5.5, d6 = n * 0.7 + 6.5, d7 = n * 0.8 + 7.5, d8 = n * 0.9 + 8.5, d9 = n * 0.10 + 9.5;
  const zero = (x: number): number => x + 1;
  const one = (x: number): number => { t += x; return t; };
  const two = (x: number): number => { t += x; u += 0.5; return t + i3; };
  const three = (x: number): number => { t += x; return t + i4 + i5; };
  const four = (x: number): number => { t += x; return t + i6 + i7 + i8; };
  const five = (x: number): number => { t += x; return t + i9 + i10 + i11 + i12; };
  const real = (x: number): number => { t += x; return t + d3 + d4; };
  const r = calls(zero, 1) + calls(zero, 2) + calls(one, 1) + calls(one, 2) + calls(two, 1) + calls(two, 2) + calls(three, 1) + calls(three, 2) + calls(four, 1) + calls(four, 2) + calls(five, 1) + calls(five, 2) + calls(real, 1) + calls(real, 2);
  return r + t + u + i0 + i1 + i2 + i3 + i4 + i5 + i6 + i7 + i8 + i9 + i10 + i11 + i12 + i13 + i14 + i15 + i16 + i17 + i18 + i19 + d0 + d1 + d2 + d3 + d4 + d5 + d6 + d7 + d8 + d9;
}
let out = first(3) + "\n";
for (let i = 0; i < 60; i++) { const a = pressure(i); if (i % 12 === 0) out += a + "\n"; }
console.log(out);
