function mixBytes(bytes: Uint8Array): number {
  let hash = 7;
  for (let at = 0; at < bytes.length; at++) hash = Math.imul(hash ^ bytes[at], 0x5bd1e995) + at | 0;
  return hash;
}

function mixList(list: number[]): number {
  let hash = -3;
  for (let at = 0; at < list.length; at++) hash = Math.imul(hash, 31) + Math.imul(list[at], list[at]) | 0;
  return hash;
}

function zerosInFront(words: Int32Array): number {
  let zeros = 0;
  for (let at = 0; at < words.length; at++) zeros += Math.clz32(words[at]);
  return zeros;
}

function timesIn32Bits(left: number, right: number): number {
  const low = left & 0xffff;
  const high = left >>> 16;
  return (low * right + (((high * right) & 0xffff) * 65536 | 0)) | 0;
}

function zerosByHand(word: number): number {
  let zeros = 0;
  for (let bit = 31; bit >= 0; bit--) {
    if ((word >>> bit) & 1) break;
    zeros++;
  }
  return zeros;
}

let same = 0;
let asked = 0;
let sum = 0;
for (let length = 0; length <= 35; length++) {
  const bytes = new Uint8Array(length);
  const words = new Int32Array(length);
  const list: number[] = [];
  for (let at = 0; at < length; at++) {
    bytes[at] = at * 37 + length;
    words[at] = at % 5 === 0 ? 0 : (1 << (at % 32)) - (at & 1) * 3;
    list.push(at % 7 === 3 ? -2147483648 : at * 65537 - 40000);
  }
  let byBytes = 7;
  for (let at = 0; at < length; at++) byBytes = timesIn32Bits((byBytes ^ bytes[at]) | 0, 0x5bd1e995) + at | 0;
  let byList = -3;
  for (let at = 0; at < length; at++) byList = timesIn32Bits(byList, 31) + timesIn32Bits(list[at], list[at]) | 0;
  let byWords = 0;
  for (let at = 0; at < length; at++) byWords += zerosByHand(words[at]);
  asked += 3;
  if (mixBytes(bytes) === byBytes) same++;
  if (mixList(list) === byList) same++;
  if (zerosInFront(words) === byWords) same++;
  sum = (sum + (byBytes >>> 0) + (byList >>> 0) + byWords) % 1000003;
}
console.log(same, "of", asked, sum);
