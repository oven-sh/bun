// skips white space in a string by index
const operations = 100;
const pattern = "    \n  \t   \r\n";
let text = "";
for (let i = 0; i < operations - 1; i++) text += pattern[i % pattern.length];
text += "x";
let total = 0;

kernel: {
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c !== " " && c !== "\n" && c !== "\r" && c !== "\t") break;
    i++;
  }
  total += i;
}

console.log(total);
