// appends every byte of a Uint8Array, changed, to a Uint8Array
const operations = 100;
const pattern = "the quick brown fox jumps over the lazy dog, ";
const text = new Uint8Array(operations);
for (let i = 0; i < operations; i++) text[i] = pattern.charCodeAt(i % pattern.length);
const out = new Uint8Array(operations);
let total = 0;

kernel: {
  let o = 0;
  for (let i = 0; i < text.length; i++) out[o++] = text[i] ^ 32;
  total += o + out[7];
}

console.log(total);
