// compares two equal strings that are not the same object
const operations = 100;
const words: string[] = [], copies: string[] = [];
for (let i = 0; i < operations; i++) {
  words.push("word" + i);
  copies.push("wo" + "rd" + i);
}
let total = 0;

kernel: {
  let count = 0;
  for (let i = 0; i < words.length; i++) if (words[i] === copies[i]) count += 1;
  total += count;
}

console.log(total);
