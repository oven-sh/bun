// Reads inside and outside a view by sums of a counter and offsets, taken by arithmetic, texts, tests of undefined, stores and calls.
function g(a: number, b: number, c: number): number { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b); return pa <= pb ? a : b; }
const view = new Uint8Array(24); for (let i = 0; i < 24; i++) view[i] = i * 11 + 3;
function f0(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = true ? v[i - 1]! : 0; s += a; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f1(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  n |= 0; at |= 0; d |= 0; above |= 0; let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = true ? v[i - 1]! : 1.5; if (a < 5) s++; else if (a >= 5) s += 2; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f2(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a: any = i >= d ? v[i - 1]! : -0; s += a === undefined ? 1 : 2; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f3(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  n |= 0; at |= 0; d |= 0; above |= 0; let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = i >= d ? v[i - 1]! : 0; s += Object.is(-a, 0) ? 1 : -a; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f4(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = i !== 3 ? v[i - 1]! : 1.5; w[i] = a; s += w[i]; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f5(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  n |= 0; at |= 0; d |= 0; above |= 0; let s: any = ""; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a: any = (i & 3) === 1 ? v[i - 1]! : -0; s += typeof a; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f6(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = (i & 3) === 1 ? v[i - 1]! : 0; s += g(a, i, 3); }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f7(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  n |= 0; at |= 0; d |= 0; above |= 0; let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = i >= d && above >= 0 ? v[i - 1]! : 1.5; l.push(a); }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f8(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  let s: any = ""; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = true ? v[i + 1]! : -0; s += a; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f9(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  n |= 0; at |= 0; d |= 0; above |= 0; let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = true ? v[i + 1]! : 0; s += Number.isNaN(a) ? 1 : 2; s += a; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f10(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = i >= d ? v[i + 1]! : 1.5; s += (a | 0); }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f11(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  n |= 0; at |= 0; d |= 0; above |= 0; let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = i !== 3 ? v[i + 1]! : -0; s += a; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f12(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = i !== 3 ? v[i + 1]! : 0; if (a < 5) s++; else if (a >= 5) s += 2; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f13(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  n |= 0; at |= 0; d |= 0; above |= 0; let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a: any = (i & 3) === 1 ? v[i + 1]! : 1.5; s += a === undefined ? 1 : 2; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f14(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = (i & 3) === 1 ? v[i + 1]! : -0; s += Object.is(-a, 0) ? 1 : -a; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f15(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  n |= 0; at |= 0; d |= 0; above |= 0; let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = i >= d && above >= 0 ? v[i + 1]! : 0; w[i] = a; s += w[i]; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f16(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  let s: any = ""; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a: any = true ? v[at + i - d]! : 1.5; s += typeof a; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f17(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  n |= 0; at |= 0; d |= 0; above |= 0; let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = true ? v[at + i - d]! : -0; s += g(a, i, 3); }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f18(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = i >= d ? v[at + i - d]! : 0; l.push(a); }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f19(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  n |= 0; at |= 0; d |= 0; above |= 0; let s: any = ""; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = i !== 3 ? v[at + i - d]! : 1.5; s += a; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f20(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = i !== 3 ? v[at + i - d]! : -0; s += Number.isNaN(a) ? 1 : 2; s += a; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f21(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  n |= 0; at |= 0; d |= 0; above |= 0; let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = (i & 3) === 1 ? v[at + i - d]! : 0; s += (a | 0); }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f22(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = i >= d && above >= 0 ? v[at + i - d]! : 1.5; s += a; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f23(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  n |= 0; at |= 0; d |= 0; above |= 0; let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = i >= d && above >= 0 ? v[at + i - d]! : -0; if (a < 5) s++; else if (a >= 5) s += 2; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f24(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a: any = true ? v[at + i + d]! : 0; s += a === undefined ? 1 : 2; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f25(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  n |= 0; at |= 0; d |= 0; above |= 0; let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = true ? v[at + i + d]! : 1.5; s += Object.is(-a, 0) ? 1 : -a; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f26(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = i >= d ? v[at + i + d]! : -0; w[i] = a; s += w[i]; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f27(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  n |= 0; at |= 0; d |= 0; above |= 0; let s: any = ""; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a: any = i !== 3 ? v[at + i + d]! : 0; s += typeof a; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f28(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = i !== 3 ? v[at + i + d]! : 1.5; s += g(a, i, 3); }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f29(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  n |= 0; at |= 0; d |= 0; above |= 0; let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = (i & 3) === 1 ? v[at + i + d]! : -0; l.push(a); }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f30(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  let s: any = ""; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = i >= d && above >= 0 ? v[at + i + d]! : 0; s += a; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f31(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  n |= 0; at |= 0; d |= 0; above |= 0; let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = i >= d && above >= 0 ? v[at + i + d]! : 1.5; s += Number.isNaN(a) ? 1 : 2; s += a; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f32(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = true ? v[n - i]! : -0; s += (a | 0); }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f33(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  n |= 0; at |= 0; d |= 0; above |= 0; let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = i >= d ? v[n - i]! : 0; s += a; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f34(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = i >= d ? v[n - i]! : 1.5; if (a < 5) s++; else if (a >= 5) s += 2; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f35(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  n |= 0; at |= 0; d |= 0; above |= 0; let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a: any = i !== 3 ? v[n - i]! : -0; s += a === undefined ? 1 : 2; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f36(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = i !== 3 ? v[n - i]! : 0; s += Object.is(-a, 0) ? 1 : -a; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f37(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  n |= 0; at |= 0; d |= 0; above |= 0; let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = (i & 3) === 1 ? v[n - i]! : 1.5; w[i] = a; s += w[i]; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f38(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  let s: any = ""; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a: any = i >= d && above >= 0 ? v[n - i]! : -0; s += typeof a; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f39(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  n |= 0; at |= 0; d |= 0; above |= 0; let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = i >= d && above >= 0 ? v[n - i]! : 0; s += g(a, i, 3); }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f40(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = true ? v[i * 2 - d]! : 1.5; l.push(a); }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f41(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  n |= 0; at |= 0; d |= 0; above |= 0; let s: any = ""; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = i >= d ? v[i * 2 - d]! : -0; s += a; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f42(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = i >= d ? v[i * 2 - d]! : 0; s += Number.isNaN(a) ? 1 : 2; s += a; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f43(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  n |= 0; at |= 0; d |= 0; above |= 0; let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = i !== 3 ? v[i * 2 - d]! : 1.5; s += (a | 0); }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f44(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = (i & 3) === 1 ? v[i * 2 - d]! : -0; s += a; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f45(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  n |= 0; at |= 0; d |= 0; above |= 0; let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = (i & 3) === 1 ? v[i * 2 - d]! : 0; if (a < 5) s++; else if (a >= 5) s += 2; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f46(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a: any = i >= d && above >= 0 ? v[i * 2 - d]! : 1.5; s += a === undefined ? 1 : 2; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f47(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  n |= 0; at |= 0; d |= 0; above |= 0; let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = i >= d && above >= 0 ? v[i * 2 - d]! : -0; s += Object.is(-a, 0) ? 1 : -a; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f48(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = true ? v[d - i]! : 0; w[i] = a; s += w[i]; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f49(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  n |= 0; at |= 0; d |= 0; above |= 0; let s: any = ""; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a: any = i >= d ? v[d - i]! : 1.5; s += typeof a; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f50(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = i >= d ? v[d - i]! : -0; s += g(a, i, 3); }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f51(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  n |= 0; at |= 0; d |= 0; above |= 0; let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = i !== 3 ? v[d - i]! : 0; l.push(a); }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f52(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  let s: any = ""; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = (i & 3) === 1 ? v[d - i]! : 1.5; s += a; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f53(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  n |= 0; at |= 0; d |= 0; above |= 0; let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = (i & 3) === 1 ? v[d - i]! : -0; s += Number.isNaN(a) ? 1 : 2; s += a; }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
function f54(v: Uint8Array, n: number, at: number, d: number, above: number): string {
  let s: number = 0; const l: number[] = [], w = new Uint8Array(64), o = { x: 0 };
  for (let i = 0; i < n; i++) { const a = i >= d && above >= 0 ? v[d - i]! : 0; s += (a | 0); }
  return s + "," + l.join("/") + "," + w.join("") + o.x;
}
const tests = [f0, f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11, f12, f13, f14, f15, f16, f17, f18, f19, f20, f21, f22, f23, f24, f25, f26, f27, f28, f29, f30, f31, f32, f33, f34, f35, f36, f37, f38, f39, f40, f41, f42, f43, f44, f45, f46, f47, f48, f49, f50, f51, f52, f53, f54];
for (let k = 0; k < tests.length; k++) {
  const t = tests[k]!;
  console.log(k, t(view, 24, 0, 1, 0), t(view, 20, 4, 3, -1), t(view, 28, 0, 2, 5), t(view.subarray(3, 9), 12, 1, 4, 0), t(new Uint8Array(0), 5, 0, 0, 0), t(view, 8, 20, 1.5, 0));
}
export {};
