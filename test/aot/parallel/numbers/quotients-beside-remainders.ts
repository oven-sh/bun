// A quotient and a remainder of the same operands, in either order, in loops that are unrolled.
function both(n: number, start: number): number { let s = 0; for (let k = 0; k < n; k++) { const a = k + start; s = (s * 3 + ((a / 10) | 0) + (a % 10) * 5) | 0; } return s; }
function turned(n: number, start: number): number { let s = 0; for (let k = 0; k < n; k++) { const a = k + start; s = (s * 3 + (a % 10) * 5 + ((a / 10) | 0)) | 0; } return s; }
function several(n: number): number { let s = 0; for (let i = 0; i < n; i++) s += Math.floor(i / 7) + ((i / 10) | 0) + (i % 10) + Math.trunc(i / 60) + (i % 60) + (i % 7); return s; }
function fixed(): number { let s = 0; for (let i = 0; i < 200; i++) { s += Math.floor(i / 7) + ((i / 10) | 0) + (i % 10) + Math.trunc(i / 60) + (i % 60); } return s; }
function ofLength(list: readonly number[]): number { let s = 0; for (let i = 0; i < list.length; i++) s = (s + ((i / 10) | 0) * 3 + (i % 10)) | 0; return s; }
function ofView(view: Uint8Array): number { let s = 0; for (let i = 0; i < view.length; i++) s = (s * 3 + ((view[i]! / 10) | 0) * 7 + (view[i]! % 10)) | 0; return s; }
function wideDivisor(x: number): string { const d = x | 0, q = (d / 4294967295) | 0, r = d % 4294967295; return q + ":" + (Object.is(r, -0) ? "-0" : r); }
function byVariable(n: number, w: number): number { let s = 0; for (let i = 0; i < n; i++) s = (s * 7 + (i % w) * ((i / w) | 0) + Math.floor(i / w)) | 0; return s; }
function later(n: number, start: number): number { let q = -1; for (let k = 0; k < n; k++) { const a = k + start, r = a % 60; if (r === 59) { q = (a / 60) | 0; break; } } return q; }
function either(n: number): number { let s = 0; for (let k = 0; k < n; k++) { const q = (k / 12) | 0; if (q === 2) { s += k % 12; continue; } s += (k % 12) * 2 + q; } return s; }
function views(view: Uint8Array, list: number[]): number { let s = 0; for (let i = 0; i < view.length; i++) s = (s + ((view[i]! / 9) | 0) * 100 + (view[i]! % 9)) | 0; for (const v of list) s = (s * 5 + Math.floor(v / 13) + (v % 13)) | 0; return s; }
function digits(n: number): string { let s = ""; do { s = (n % 58) + "." + s; n = Math.floor(n / 58); } while (n > 0); return s; }
function carry(list: number[], c: number): string { for (let k = 0; k < list.length; k++) { c += list[k]! << 8; list[k] = c % 58; c = (c / 58) | 0; } return list.join() + ":" + c; }
for (const n of [0, 1, 7, 8, 9, 40, 133]) for (const start of [0, -20, 2147483600, -2147483648, 4294967290]) console.log(n, start, both(n, start), turned(n, start), several(n), later(n, start), either(n));
console.log(fixed(), ofLength([]), ofLength(new Array(9).fill(1)), ofLength(new Array(77).fill(1)), ofView(new Uint8Array(100).map((_, i) => i * 7)));
for (const x of [0, 5, -5, 2147483647, -2147483648]) console.log(x, wideDivisor(x));
for (const w of [1, 2, 3, 10, 16, -3, 0, 2147483647, 0.5]) console.log(w, byVariable(50, w));
console.log(views(new Uint8Array(40).map((_, i) => i * 41), [1, 2, 900, -5, 4294967295, 7]), digits(0), digits(4294967295), digits(1e15), carry([5, 9, 1, 200, 7], 3), carry([5, 9, -1, 200, 7], -300));
export {};
