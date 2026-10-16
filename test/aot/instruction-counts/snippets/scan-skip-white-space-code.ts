// skips white space in a string by charCodeAt
const operations = 100;
const pattern = "    \n  \t   \r\n";
let text = "";
for (let i = 0; i < operations - 1; i++) text += pattern[i % pattern.length];
text += "x";
let total = 0;

kernel: {
  let i = 0;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c !== 32 && c !== 10 && c !== 13 && c !== 9) break;
    i++;
  }
  total += i;
}

console.log(total);
