// Counted loops whose bound is not the array length: bounds checks are dropped while the index stays in range. Out-of-bounds reads, stores that grow the array and negative indices behave as in a checked loop.
declare const console: { log(...v: unknown[]): void };
function sumTo(list: number[], n: number): number { let t = 0; for (let i = 0; i < n; i++) t += list[i]!; return t; }
function sumOr(list: number[], from: number, n: number): number { let t = 0; for (let i = from; i < n; i++) t += list[i] ?? -1000; return t; }
function inclusive(list: number[], last: number): number { let t = 0; for (let i = 0; i <= last; i++) t += list[i] ?? 0.5; return t; }
function neighbours(s: Float64Array, from: number, to: number): number { let t = 0; for (let i = from; i < to; i++) t += (s[i - 1] ?? 100) + s[i]! * 2 + (s[i + 1] ?? 10000); return t; }
function blurred(s: Float64Array): number { const end = s.length - 2; for (let i = 2; i < end; i++) s[i] = s[i]! * 0.5 + (s[i - 2]! + s[i + 2]!) * 0.25; return s[s.length >> 1]!; }
function addScaled(row: number[], b: number[], k: number, n: number): void { for (let j = 0; j < n; j++) row[j] = row[j]! + k * b[j]!; }
function fillTo(list: number[], n: number): number { for (let i = 0; i < n; i++) list[i] = i * 2; return list.length; }
function bytes(b: Uint8Array, n: number): number { let t = 0; for (let i = 0; i < n; i++) { const c = b[i]; t += c === undefined ? 1000 : c; } return t; }
function storeBytes(b: Uint8Array, n: number): number { for (let i = 0; i < n; i++) b[i] = i; let t = 0; for (let i = 0; i < b.length; i++) t += b[i]!; return t; }
function keptAnInt32(chars: Uint16Array, from: number, end: number): number { let at = from | 0, h = 0, turns = 0; while (at < end) { const c = chars[at]; h = (Math.imul(h, 31) + (c === undefined ? 7 : c)) | 0; at = (at + 1) | 0; if (++turns > 40) break; } return h + at; }
function byThree(list: number[], n: number): number { let t = 0; for (let i = 0; i < n; i += 3) t += list[i] ?? -1; return t; }
function shrinksMeanwhile(list: number[], n: number): number { let t = 0; for (let i = 0; i < n; i++) { t += list[i] ?? -5; if (i === 3) list.length = 5; } return t; }
function growsMeanwhile(list: number[], n: number): number { let t = 0; for (let i = 0; i < n; i++) { t += list[i] ?? -5; if (i === 2) list.push(50, 60); } return t; }
function boundChanges(list: number[]): number { let t = 0; let n = 3; for (let i = 0; i < n; i++) { t += list[i] ?? -7; if (i === 2 && n < 12) n = 12; } return t; }
function counterIsSetBack(list: number[], n: number): number { let t = 0; let again = true; for (let i = 2; i < n; i++) { t += list[i] ?? -9; if (again && i === 4) { again = false; i = -3; } } return t; }
function holes(n: number): number { const list: number[] = [1, 2, 3, 4, 5, 6]; delete list[2]; let t = 0; for (let i = 0; i < n; i++) t += list[i] ?? 100; return t; }
function detached(n: number): string { const buffer = new ArrayBuffer(16, { maxByteLength: 32 }); const view = new Uint8Array(buffer); for (let i = 0; i < 16; i++) view[i] = i + 1; let out = ""; for (let i = 0; i < n; i++) { out += view[i] + ","; if (i === 3) buffer.resize(6); if (i === 8) buffer.resize(12); } return out; }
function notANumberBound(list: number[], n: number): number { let t = 0; for (let i = 0; i < n; i++) t += list[i] ?? 1; return t; }

const list: number[] = []; for (let i = 0; i < 40; i++) list.push(i * 0.5);
const other: number[] = []; for (let i = 0; i < 40; i++) other.push(40 - i);
const s = new Float64Array(40); for (let i = 0; i < 40; i++) s[i] = (i * 7) % 13;
const b = new Uint8Array(40); for (let i = 0; i < 40; i++) b[i] = i * 5;
const chars = new Uint16Array(40); for (let i = 0; i < 40; i++) chars[i] = 97 + (i % 26);
const out: unknown[] = [];
for (let r = 0; r < 3; r++) {
  out.push(sumTo(list, 40), sumTo(list, 0), sumTo(list, -3), sumTo(list, 39), Number.isNaN(sumTo(list, 41)));
  out.push(sumOr(list, 0, 40), sumOr(list, -2, 3), sumOr(list, 38, 43), sumOr(list, 50, 52), sumOr(list, 5, 2), sumOr(list, 0.5, 3), sumOr(list, 0, 2.5));
  out.push(inclusive(list, 39), inclusive(list, 40), inclusive(list, -1), inclusive(list, 0));
  out.push(neighbours(s, 1, 39), neighbours(s, 0, 40), neighbours(s, 39, 41), neighbours(s, -1, 1), blurred(s));
  addScaled(other, list, 0.5, 40); addScaled(other, list, 0.25, 10); out.push(other[0], other[9], other[10], other[39], other.length);
  out.push(bytes(b, 40), bytes(b, 42), bytes(b, 0), storeBytes(new Uint8Array(8), 8), storeBytes(new Uint8Array(8), 300), storeBytes(new Uint8Array(0), 3));
  out.push(keptAnInt32(chars, 0, 40), keptAnInt32(chars, 0, 45), keptAnInt32(chars, -2, 3), keptAnInt32(chars, 2147483640, 2147483647), keptAnInt32(chars, 2147483640, 2147483650), keptAnInt32(chars, 2147483640, Infinity), keptAnInt32(chars, 0, -1));
  out.push(byThree(list, 40), byThree(list, 44), fillTo([], 5), fillTo([9, 9, 9], 2), fillTo([1], 70000) );
  out.push(shrinksMeanwhile([1, 2, 3, 4, 5, 6, 7, 8], 8), growsMeanwhile([1, 2, 3], 5), boundChanges(list), counterIsSetBack(list, 7), holes(6), holes(8), detached(14));
  out.push(notANumberBound(list, NaN), notANumberBound(list, Infinity > 1 ? 3 : 0), notANumberBound(list, 4294967296 > 1 ? 41 : 0));
}
console.log(out.join(" "));
