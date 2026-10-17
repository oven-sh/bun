// fills an empty array of strings by storing at the index of the loop
const operations = 16;
const word = "w" + operations;
let total = 0;

kernel: {
  const words: string[] = [];
  for (let i = 0; i < operations; i++) words[i] = word;
  total += words.length;
}

console.log(total);
