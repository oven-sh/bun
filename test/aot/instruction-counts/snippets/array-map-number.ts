// turns an array of numerals into numbers with map(Number)
const operations = 16;
const numerals: string[] = [];
for (let i = 0; i < operations; i++) numerals.push(String(i * 7));
let total = 0;

kernel: {
  total += numerals.map(Number).length;
}

console.log(total);
