// STATISTIC: LoopsWhoseTurnsAreLaidOut >= 3
// A position that is itself a product or a count of zeros keeps its own test in the turn; two texts are walked by one counter; a text far longer than eight turns; a sum of products.
function atProducts(text: string): number {
  let hash = 1;
  for (let at = 0; at < text.length; at++) hash = Math.imul(hash, 33) ^ (text.charCodeAt(Math.imul(at, 3)) | 0);
  return hash;
}

function underMask(list: number[]): number {
  let hash = -3;
  for (let at = 0; at < list.length; at++) hash = Math.imul(hash, 31) + Math.imul(list[Math.imul(at, 3) & 7], 5) | 0;
  return hash;
}

function atZeros(bytes: Uint8Array, words: Int32Array): number {
  let sum = 0;
  for (let at = 0; at < words.length; at++) sum = Math.imul(sum, 3) + (bytes[Math.clz32(words[at])] | 0) | 0;
  return sum;
}

function twoTexts(text: string, other: string): number {
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at++) { hash ^= Math.imul(text.charCodeAt(at), other.charCodeAt(at)); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

function sumOfProducts(left: Int32Array, right: Int32Array): number {
  let sum = 0;
  for (let at = 0; at < left.length; at++) sum = sum + Math.imul(left[at], right[at]) + Math.imul(left[at], 7) | 0;
  return sum;
}

const narrow = "the quick brown fox jumps over the lazy dog, twice over and once more";
const wide = "Ж中é the quick Ω brown fox ￿ jumps 😀 over the lazy dog \u0001";
const said: (number | string)[] = [];
for (const length of [0, 1, 7, 8, 9, 15, 16, 17, 31, 32, 33, 41]) {
  for (const whole of [narrow, wide]) {
    const piece = whole.slice(1, 1 + length);
    said.push(atProducts(piece), twoTexts(piece, narrow), twoTexts(piece, wide), twoTexts(piece, piece.slice(0, length >> 1)));
  }
  const list = Array.from({ length }, (_, at) => at * 65537 - 40000);
  const words = Int32Array.from({ length }, (_, at) => (at % 5 === 0 ? 0 : 1 << (at % 32)));
  said.push(underMask(list), atZeros(new Uint8Array(20).map((_, at) => at * 11 + 1), words), sumOfProducts(words, Int32Array.from(list)));
}
const long = narrow.repeat(300) + wide;
said.push(atProducts(long), twoTexts(long, long), twoTexts(narrow.repeat(300), long));
let all = 0;
for (const one of said) all = (Math.imul(all, 31) + (one as number)) | 0;
console.log(said.length, all, said.slice(-3).join(" "), said.slice(40, 47).join(" "));
