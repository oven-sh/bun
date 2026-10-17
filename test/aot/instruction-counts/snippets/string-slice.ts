// takes a slice of a string
const operations = 100;
const words: string[] = [];
for (let i = 0; i < operations; i++) words.push("a longer word " + i);
let total = 0;

kernel: {
  let length = 0;
  for (let i = 0; i < words.length; i++) length += words[i].slice(2, 9).length;
  total += length;
}

console.log(total);
