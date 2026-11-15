function stepsByZeros(words: Int32Array): number {
  let sum = 0;
  for (let at = 0; at < words.length; at += Math.clz32(words[at]) + 1) sum = Math.imul(sum, 7) + at | 0;
  return sum;
}

function boundByProduct(bytes: Uint8Array, wide: number, high: number): number {
  let sum = 1;
  for (let at = 0; at < Math.imul(wide, high); at++) sum = Math.imul(sum ^ bytes[at % bytes.length], 13);
  return sum;
}

function leavesAtProduct(bytes: Uint8Array, wanted: number): number {
  let hash = 3;
  let at = 0;
  for (; at < bytes.length; at++) {
    hash = Math.imul(hash + bytes[at], 5);
    if ((hash & 63) === wanted) break;
  }
  return at * 100003 + (hash & 1023);
}

function countsDown(bytes: Uint8Array): number {
  let hash = 9;
  for (let at = bytes.length - 1; at >= 0; at--) hash = Math.imul(hash, 3) ^ Math.clz32(bytes[at]);
  return hash;
}

function times(left: number, right: number): number {
  const low = left & 0xffff;
  const high = left >>> 16;
  return (low * right + (((high * right) & 0xffff) * 65536 | 0)) | 0;
}

function zeros(word: number): number {
  let count = 0;
  for (let bit = 31; bit >= 0; bit--) {
    if ((word >>> bit) & 1) break;
    count++;
  }
  return count;
}

let same = 0;
let asked = 0;
let total = 0;
for (let length = 0; length <= 34; length++) {
  const bytes = new Uint8Array(Math.max(length, 1));
  const words = new Int32Array(length);
  for (let at = 0; at < length; at++) {
    bytes[at] = at * 29 + length * 3;
    words[at] = at % 3 === 0 ? -1 - at : 1 << (31 - (at % 4));
  }
  let a = 0;
  for (let at = 0; at < length; at += zeros(words[at]) + 1) a = times(a, 7) + at | 0;
  let b = 1;
  for (let at = 0; at < length * 2; at++) b = times((b ^ bytes[at % bytes.length]) | 0, 13);
  let d = 9;
  for (let at = bytes.length - 1; at >= 0; at--) d = times(d, 3) ^ zeros(bytes[at]);
  asked += 3;
  if (stepsByZeros(words) === a) same++;
  if (boundByProduct(bytes, length, 2) === b) same++;
  if (countsDown(bytes) === d) same++;
  for (let wanted = 0; wanted < 64; wanted += 7) {
    let hash = 3;
    let at = 0;
    while (at < bytes.length) {
      hash = times(hash + bytes[at], 5);
      if ((hash & 63) === wanted) break;
      at++;
    }
    asked++;
    if (leavesAtProduct(bytes, wanted) === at * 100003 + (hash & 1023)) same++;
  }
  total = (total + (a >>> 0) + (b >>> 0) + (d >>> 0)) % 1000003;
}
console.log(same, "of", asked, total);
