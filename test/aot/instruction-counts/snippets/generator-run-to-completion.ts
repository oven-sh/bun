// creates a generator object that returns without a yield, and resumes it once
function* double(x: number): Generator<never, number, void> {
  return x * 2;
}
const operations = 100;
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) total += double(i).next().value;
}

console.log(total);
