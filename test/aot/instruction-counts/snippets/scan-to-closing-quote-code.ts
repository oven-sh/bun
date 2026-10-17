// scans a string by charCodeAt to the closing quote, with a test for an escape and one for control characters
const operations = 100;
const pattern = "the quick brown fox jumps over the lazy dog, ";
let text = "";
for (let i = 0; i < operations - 1; i++) text += pattern[i % pattern.length];
text += '"';
let total = 0;

kernel: {
  let i = 0;
  while (i < text.length) {
    const c = text.charCodeAt(i);
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
