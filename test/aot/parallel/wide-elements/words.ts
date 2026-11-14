// Lists whose numbers are unsigned 32-bit words, read outside loops: by bit operators, sums and comparisons; with holes, past the end, under keys that are none.
declare const process: { readonly argv: readonly string[] };
const show = (v: unknown): string => Object.is(v, -0) ? "-0" : String(v);
const table: number[] = []; for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; table.push(c >>> 0); }
const small: number[] = []; for (let i = 0; i < 8; i++) small.push(i >>> 0);
const holes: number[] = [1 >>> 0, 2 >>> 0]; holes[5] = 4294967295 >>> 0; holes.length = 9;
const mixed: number[] = [1 >>> 0]; if (process.argv[3]) mixed.push(0.5);
function step(list: number[], c: number, byte: number): number { return (c >>> 8) ^ list[(c ^ byte) & 255]!; }
function crc(a: number, b: number): number { let c = -1; c = (c >>> 8) ^ table[(c ^ a) & 255]!; c = (c >>> 8) ^ table[(c ^ b) & 255]!; return (c ^ -1) >>> 0; }
function reads(list: number[], i: number): string { return [list[i]! ^ 1, list[i]! | 0, list[i]! >>> 0, ~list[i]!, list[i]! & 0xffff, 1 << list[i]!, list[i]! >> 3, list[i]! + 1, list[i]! - list[i + 1]!, list[i]! * 2, list[i]! < 5, list[i]! === 4294967295, list[i], -list[i]!, list[i]! % 10, list[i]! / 2, list[i] ?? "none", String(list[i])].map(show).join(" "); }
function twice(list: number[], i: number): number { const x = list[i]!; return (x ^ i) + (x >>> 1) + (x & 7); }
function taken(list: number[], i: number): string { const x = list[i]!; return x ^ 1 ? show(x) : "one"; }
const keys: number[] = JSON.parse(process.argv[2] ?? "null") ?? [0, 1, 2, 5, 7, 8, 9, 255, 256, -1, 1.5, 4294967295];
for (const list of [table, small, holes, mixed]) for (const i of keys) console.log(reads(list, i), show(twice(list, i)), taken(list, i), show(step(list, i, 77)));
for (const a of keys) for (const b of keys) console.log(show(crc(a, b)));
let c = 0; for (let i = 0; i < 1000; i++) c = step(table, c, i & 255); console.log(c >>> 0);
table[3] = -1; table[4] = 0.5; delete table[5]; console.log(reads(table, 3), reads(table, 4), reads(table, 5), crc(3, 4));
