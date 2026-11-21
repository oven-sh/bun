// >>> 0 in loops that are unrolled, over views and arrays of integers, of doubles, with holes, negative zeros, fractions and numbers beyond 32 bits.
function sum(list: number[]): number { let s = 0; for (let i = 0; i < list.length; i++) s = (s + list[i]!) >>> 0; return s; }
function mixed(list: number[]): number { let s = 1; for (let i = 0; i < list.length; i++) s = (Math.imul(s, 31) ^ (list[i]! >>> 3)) >>> 0; return s; }
function total(list: number[]): number { let s = 0; for (let i = 0; i < list.length; i++) s += list[i]! >>> 1; return s; }
function view32(view: Uint32Array): number { let s = 0; for (let i = 0; i < view.length; i++) s = (s + view[i]!) >>> 0; return s; }
function signed(view: Int32Array): number { let s = 0; for (let i = 0; i < view.length; i++) s = (s + (view[i]! >>> 0) / 2) >>> 0; return s; }
function shifts(n: number): number { let s = 0; for (let i = 0; i < n; i++) s += (i - 9) >>> (i & 31); return s; }
function text(t: string): number { let h = 0; for (let i = 0; i < t.length; i++) h = (h * 33 + t.charCodeAt(i)) >>> 0; return h; }
function crc(data: Uint8Array, table: number[]): number { let c = 0xffffffff; for (let i = 0; i < data.length; i++) c = (table[(c ^ data[i]!) & 0xff]! ^ (c >>> 8)) >>> 0; return (c ^ 0xffffffff) >>> 0; }
const table: number[] = []; for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; table.push(c >>> 0); }
const words: number[] = []; for (let i = 0; i < 37; i++) words.push((i * 2654435761) >>> 0);
const holes = words.slice(); delete holes[5]; delete holes[30];
const lists: number[][] = [words, holes, [1, 2, 3], [], [4294967295, 4294967295], [-1, -0, 0.5, 1.9], [1e300, NaN, Infinity, 2 ** 53, -(2 ** 53), 2 ** 32], new Array<number>(20).fill(7), words.map(w => -w)];
for (let round = 0; round < 2; round++) for (const list of lists) console.log(sum(list), mixed(list), total(list), view32(new Uint32Array(list)), signed(new Int32Array(list)), shifts(list.length));
console.log(text(""), text("hello world, hello"), crc(new Uint8Array(50).map((_, i) => i * 7), table), crc(new Uint8Array(0), table));
export {};
