// fills an empty array that came out of a call by storing at the index of the loop
const operations = 16;
const word = "w" + operations;
let total = 0;
let made = 0;
function make(): string[] {
  if (++made < 0) return make();
  return [];
}

kernel: {
  const words = make();
  for (let i = 0; i < operations; i++) words[i] = word;
  total += words.length;
}

console.log(total);
