// replaces every "&" in a string that holds none
const operations = 100;
const words: string[] = [];
for (let i = 0; i < operations; i++) words.push("a piece of text without it " + i);
let total = 0;

kernel: {
  let length = 0;
  for (let i = 0; i < words.length; i++) length += words[i].replace(/&/g, "&amp;").length;
  total += length;
}

console.log(total);
