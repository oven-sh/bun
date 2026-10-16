// skips white space in a Uint8Array
const operations = 100;
const pattern = "    \n  \t   \r\n";
const text = new Uint8Array(operations);
for (let i = 0; i < operations; i++) text[i] = pattern.charCodeAt(i % pattern.length);
text[operations - 1] = 120;
let total = 0;

kernel: {
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c !== 32 && c !== 10 && c !== 13 && c !== 9) break;
    i++;
  }
  total += i;
}

console.log(total);
