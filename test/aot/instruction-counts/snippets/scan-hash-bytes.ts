// hashes a Uint8Array: hash = (hash * 33) ^ c
const operations = 100;
const pattern = "the quick brown fox jumps over the lazy dog, ";
const text = new Uint8Array(operations);
for (let i = 0; i < operations; i++) text[i] = pattern.charCodeAt(i % pattern.length);
let total = 0;

kernel: {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = (hash * 33) ^ text[i];
  total += hash;
}

console.log(total);
