// Elements of arrays of doubles that are read for their bits alone, and as terms of sums that are cut to 32 bits.
const table: number[] = []; for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; table.push(c >>> 0); }
const keys = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5], halves = [0.5, 1.5, 4294967296.5, -0.5, NaN, Infinity, 1e300, 2 ** 53], holes = keys.slice(); delete holes[3];
function crc(data: Uint8Array): number { let c = 0xffffffff; for (let i = 0; i < data.length; i++) c = table[(c ^ data[i]!) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function mix(list: number[], seed: number): number { let a = seed | 0, b = 0; for (let i = 0; i < list.length; i++) { a = (a + list[i]! + ((b << 5) ^ (b >>> 2))) | 0; b = (b - list[i]! + a) | 0; } return a ^ b; }
function words(list: number[]): number { let s = 0; for (const e of list) s ^= (e << 3) ^ (e >>> 1) ^ ~e; return s; }
function rounds(list: number[], n: number): number { let h = 0x6a09e667; for (let i = 0; i < n; i++) h = (Math.imul(h, 31) + list[i & 7]! + i) | 0; return h >>> 0; }
function spread(list: number[]): number { const w: number[] = []; for (let i = 0; i < 8; i++) w[i] = list[i]!; for (let i = 8; i < 24; i++) w[i] = (w[i - 8]! + (w[i - 7]! ^ (w[i - 2]! >>> 3)) + w[i - 1]!) | 0; return w[23]!; }
class Cipher { private readonly box: number[] = []; constructor(key: number) { for (let i = 0; i < 16; i++) this.box.push((i * 0x9e3779b1 + key) >>> 0); } encrypt(left: number, right: number): string { for (let i = 0; i < 16; i++) { left ^= this.box[i]!; right ^= (this.box[left & 15]! + this.box[(left >>> 4) & 15]!) | 0; const t = left; left = right; right = t; } return (left >>> 0) + "/" + (right >>> 0); } }
console.log(crc(new Uint8Array(100).map((_, i) => i * 7)), crc(new Uint8Array(0)), new Cipher(7).encrypt(1, 2), new Cipher(-9).encrypt(-1, 0x7fffffff));
for (const list of [keys, halves, holes, [1, 2, 3], [], table, [-1, -0, 4294967295, 5, 6, 7, 8, 9]]) for (const seed of [0, 1, -2147483648]) console.log(mix(list, seed), words(list), rounds(list, 20), spread(list));
export {};
