// appends every byte of a string by charCodeAt, changed, to a Uint8Array
const operations = 100;
const pattern = "the quick brown fox jumps over the lazy dog, ";
let text = "";
for (let i = 0; i < operations - 0; i++) text += pattern[i % pattern.length];
const out = new Uint8Array(operations);
let total = 0;

kernel: {
  let o = 0;
  for (let i = 0; i < text.length; i++) out[o++] = text.charCodeAt(i) ^ 32;
  total += o + out[7];
}

console.log(total);
