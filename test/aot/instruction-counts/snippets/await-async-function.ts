// awaits an async function that returns at once
async function double(x: number): Promise<number> {
  return x * 2;
}
const operations = 20;
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) total += await double(i);
}

console.log(total);
