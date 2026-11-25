function rounds(state: Uint32Array, words: Uint32Array): void {
  let a = state[0], b = state[1], c = state[2], d = state[3];
  for (let i = 0; i < words.length; i++) {
    const s = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const t = (d + s + ((a & b) ^ (~a & c)) + words[i]) | 0;
    d = c; c = b; b = a; a = t;
  }
  state[0] += a; state[1] += b; state[2] += c; state[3] += d;
}
function short(state: Uint32Array, words: Uint32Array): string {
  let a = state[0], b = state[5];
  for (let i = 0; i < words.length; i++) { const t = ((a << 1) ^ (b as number) ^ words[i]) | 0; b = a; a = t; }
  return a + " " + b;
}
const state = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a]);
const words = new Uint32Array(64);
for (let i = 0; i < 64; i++) words[i] = (i * 0x9e3779b9) >>> 0;
for (let k = 0; k < 50; k++) { rounds(state, words); if (k % 10 === 0) console.log(k, state[0], state[1], state[2], state[3]); }
console.log(state.join(","));
rounds(state, new Uint32Array(0));
console.log(state.join(","));
console.log(short(state, words), short(state, new Uint32Array(0)), short(new Uint32Array(0), words));
