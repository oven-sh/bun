// joins two strings
const operations = 100;
const words: string[] = [];
for (let i = 0; i < operations; i++) words.push("word" + i);
let total = 0;

kernel: {
  let length = 0;
  for (let i = 1; i <= words.length; i++) length += (words[i - 1] + words[operations - i]).length;
  total += length;
}

console.log(total);
