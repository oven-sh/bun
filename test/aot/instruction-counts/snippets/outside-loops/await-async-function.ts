// awaits an async function, outside loops
const operations = 2;
async function answer(n: number): Promise<number> {
  return n + 1;
}
let total = 0;

kernel: {
  total = await answer(total);
  total = await answer(total);
}

console.log(total);
