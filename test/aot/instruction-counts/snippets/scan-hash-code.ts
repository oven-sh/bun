// hashes a string by charCodeAt: hash = (hash * 33) ^ c
const operations = 100;
const pattern = "the quick brown fox jumps over the lazy dog, ";
let text = "";
for (let i = 0; i < operations - 0; i++) text += pattern[i % pattern.length];
let total = 0;

kernel: {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = (hash * 33) ^ text.charCodeAt(i);
  total += hash;
}

console.log(total);
