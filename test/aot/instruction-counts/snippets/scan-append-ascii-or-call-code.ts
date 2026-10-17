// appends the ASCII characters of a string to a Uint8Array and calls a function for the others
const operations = 100;
const pattern = "the quick brown fox jumps over the lazy dog, ";
let text = "";
for (let i = 0; i < operations - 0; i++) text += pattern[i % pattern.length];
const out = new Uint8Array(operations);
const seen = [0];
const other = [(c: number) => seen.push(c), (c: number) => seen.unshift(c)];
let total = 0;

kernel: {
  let o = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) out[o++] = c;
    else other[c & 1](c);
  }
  total += o + out[7];
}

console.log(total);
