// A remainder is stored and tested before the quotient of the same operands is taken, at the end of an iteration, behind it, and outside of loops.
function carry(list: number[], c: number, base: number): string { for (let k = 0; k < list.length; k++) { c += list[k]! << 8; list[k] = c % base; c = (c / base) | 0; } return list.join() + ":" + c; }
function byConstant(list: number[], c: number): string { for (let k = 0; k < list.length; k++) { c += list[k]! << 8; list[k] = c % 58; c = (c / 58) | 0; } return list.join() + ":" + c; }
function view(bytes: Uint8Array, c: number): string { for (let k = bytes.length - 1; k >= 0; k--) { c += bytes[k]! * 58; bytes[k] = c % 256; c = Math.floor(c / 256); } return bytes.join() + ":" + c; }
function digits(n: number, base: number): number[] { const out: number[] = []; while (n > 0) { out.push(n % base); n = (n / base) | 0; } return out; }
function ends(n: number, stop: number): number { let q = -1; for (let k = 0; k < n; k++) { const r = k % 12; if (r === stop) { q = (k / 12) | 0; break; } } return q; }
function behind(n: number): number { let s = 0, r = 0, k = 0; for (; k < n; k++) { r = k % 9; if (r > 6) continue; s += r; } return s * 1000 + ((k / 9) | 0) + r; }
function once(x: number, y: number): string { const r = x % y; if (r < 0) return "n" + r; const q = (x / y) | 0; return q + "." + r; }
function inner(n: number): number { let s = 0; for (let i = 0; i < n; i++) { const r = i % 5; for (let j = 0; j < 3; j++) s = (s * 3 + r + j) | 0; s = (s + ((i / 5) | 0)) | 0; } return s; }
for (const base of [58, 1, 2, 10, 256, -58, 0, 2147483647, 0.5]) console.log(base, carry([5, 9, 1, 200, 7], 3, base), carry([0, -1, 300, 2], -40000, base), digits(123456, base > 1 ? base : 3).join(), once(1000, base), once(-1000, base));
console.log(byConstant([5, 9, 1, 200, 7], 3), byConstant([], 77), byConstant(new Array(20).fill(255), 0), view(new Uint8Array([1, 2, 3, 250, 255, 0, 9, 8, 7]), 57), [0, 5, 11, 12].map(s => ends(40, s)).join(), [0, 1, 8, 9, 10, 41].map(behind).join(), [0, 1, 4, 5, 16, 33].map(inner).join());
export {};
