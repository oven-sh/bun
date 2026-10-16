// counts up in a loop that does nothing else
const operations = 100;
let total = 0;

kernel: {
  let count = 0;
  for (let i = 0; i < operations; i++) count += 1;
  total += count;
}

console.log(total);
