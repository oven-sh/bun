function hashOfText(text: string): number {
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at++) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hashByHand(text: string): number {
  let hash = 0x811c9dc5;
  let at = 0;
  while (true) {
    if (at >= text.length) break;
    const mixed = (hash ^ text.charCodeAt(at)) >>> 0;
    const low = mixed & 0xffff;
    const high = mixed >>> 16;
    hash = (low * 16777619 + (((high * 16777619) & 0xffff) * 65536)) % 4294967296;
    at += 1;
  }
  return hash >>> 0;
}

const narrow = "the quick brown fox jumps over the lazy dog, twice over and once more";
const wide = "Ж中é the quick Ω brown fox ￿ jumps 😀 over the lazy dog \u0001";
let same = 0;
let asked = 0;
let sum = 0;
for (let length = 0; length <= 40; length++) {
  for (const whole of [narrow, wide]) {
    for (let from = 0; from < 3; from++) {
      const piece = whole.slice(from, from + length);
      const joined = piece.slice(0, length >> 1) + piece.slice(length >> 1);
      asked += 2;
      const expected = hashByHand(piece);
      if (hashOfText(piece) === expected) same++;
      if (hashOfText(joined) === expected) same++;
      sum = (sum + expected) % 1000003;
    }
  }
}
console.log(same, "of", asked, sum);
