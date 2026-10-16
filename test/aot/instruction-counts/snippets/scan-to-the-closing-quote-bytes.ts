// scans a Uint8Array to the closing quote, with a test for an escape and one for control characters
const operations = 100;
const pattern = "the quick brown fox jumps over the lazy dog, ";
const text = new Uint8Array(operations);
for (let i = 0; i < operations; i++) text[i] = pattern.charCodeAt(i % pattern.length);
text[operations - 1] = 34;
let total = 0;

kernel: {
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === 34) break;
    if (c === 92) {
      i += 2;
      continue;
    }
    if (c < 32) total -= 1;
    i++;
  }
  total += i;
}

console.log(total);
