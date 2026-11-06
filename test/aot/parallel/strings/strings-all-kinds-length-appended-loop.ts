// Strings are put together piece by piece: pieces of every length round the widths that are moved at once, ropes, substrings, 16-bit text, pieces long enough to be kept by reference, and a buffer that runs full.
function given<T>(text: string): T { return JSON.parse(text) as T; }
function checksum(text: string): string {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0;
  return text.length + ":" + sum;
}
function joinAll(parts: string[]): string { let out = ""; for (const part of parts) out += part; return out; }
function joinWith(parts: string[], between: string): string { let out = ""; for (const part of parts) out += part + between; return out; }
function framed(a: string, b: string, c: string): string { return `<${a}|${b}|${c}>`; }
function maybe(a: string | undefined, b: string | null): string { return `[${a}][${b}]`; }
function repeated(part: string, times: number): string { let out = ""; for (let i = 0; i < times; i++) out += part; return out; }

const alphabet = given<string>('"abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-_"');
const lengths = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 23, 24, 25, 31, 32, 33, 47, 48, 49, 63, 64];
const pieces = lengths.map(length => alphabet.slice(0, length));
console.log(joinAll(pieces) === pieces.join(""), checksum(joinAll(pieces)));
for (const piece of pieces) console.log(piece.length, framed(piece, piece, piece), checksum(repeated(piece, 7)));
for (const start of [0, 1, 2, 3, 5, 7]) console.log(joinWith(lengths.map(length => alphabet.slice(start, start + length)), "/"));

// Flat copies of the same pieces: a slice may be a substring of its base.
const flat = pieces.map(piece => given<string>(JSON.stringify(piece)));
console.log(joinAll(flat) === joinAll(pieces), checksum(joinWith(flat, ", ")));

// Ropes, and ropes of ropes.
const ropes = flat.map((piece, index) => piece + flat[flat.length - 1 - index]);
console.log(checksum(joinAll(ropes)), checksum(joinAll(ropes.map((rope, index) => rope + ropes[index >> 1]))));
console.log(framed(ropes[3], ropes[20], ropes[29]));

// 16-bit text among 8-bit text, first, last and between.
const wide = given<string[]>('["\\u03b1", "\\u03b1\\u03b2\\u03b3", "x\\u4e2d", "\\ud83d\\ude00", "\\u00e9", "\\u00ff\\u0100"]');
for (const text of wide) console.log(framed(text, "plain", text), framed("plain", text, "plain"), checksum(repeated(text, 9)), checksum(joinWith([text, "a", text, "bb"], text)));
console.log(checksum(joinAll([...flat, ...wide, ...flat])), checksum(joinAll([...wide, ...flat])));

// Latin-1 above ASCII stays 8-bit.
const latin = given<string>('"\\u00e0\\u00e9\\u00ee\\u00f5\\u00fc\\u00ff"');
console.log(framed(latin, latin + latin, latin.slice(1, 4)), checksum(repeated(latin, 11)));

// Long pieces: below, at and above the length from which a piece is kept by reference, and a result that outgrows every buffer.
for (const length of [1000, 4095, 4096, 4097, 65535, 65536, 65537, 200000]) {
  const long = repeated(alphabet, Math.ceil(length / alphabet.length)).slice(0, length);
  const flatLong = given<string>(JSON.stringify(long));
  console.log(length, checksum(framed(long, "x", flatLong)), checksum(joinAll([flatLong, "-", flatLong, "-", long])), checksum(repeated(flatLong, 3)));
}
console.log(checksum(repeated(alphabet, 5000)), checksum(repeated("ab", 100000)), checksum(repeated("c", 300000)));

// undefined and null among the pieces.
console.log(maybe(undefined, null), maybe("a", null), maybe(undefined, "b"), maybe(alphabet, alphabet.slice(3, 20)), maybe(wide[2], wide[3]));

// The pieces are what they were, and the results are strings like any other.
const result = joinAll(flat);
console.log(flat[16], pieces[16], result.slice(100, 120), result.indexOf("9A"), result === joinAll(pieces), new Set([result, joinAll(pieces)]).size, { [framed("k", "e", "y")]: 1 }["<k|e|y>"]);

// Many results kept alive while the collector runs.
const kept: string[] = [];
for (let i = 0; i < 3000; i++) kept.push(framed(flat[i % flat.length], String(i), ropes[i % ropes.length]));
Bun.gc(true);
console.log(checksum(kept.join("")));
