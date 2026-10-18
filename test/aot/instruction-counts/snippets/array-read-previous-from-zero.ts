// subtracts the previous element from each element, starting at index 0
const operations = 100;
const levels: number[] = [];
for (let i = 0; i < operations; i++) levels.push(i * 0.75);
let total = 0;

kernel: {
  let rise = 0;
  for (let i = 0; i < levels.length; i++) rise += levels[i]! - (levels[i - 1] ?? 0);
  total += rise;
}

console.log(total);
