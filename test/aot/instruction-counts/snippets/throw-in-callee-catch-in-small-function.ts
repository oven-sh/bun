// throws a new Error in a function that only the loop of a small function calls and catches it there
const operations = 20;
function check(value: number): number {
  if (value < 0) {
    let scaled = value;
    for (let i = 1; i <= 3; i++) scaled = scaled * 1.5 + i + Math.sqrt(scaled * scaled + i) + Math.abs(scaled - i) + Math.floor(scaled / i);
    return scaled;
  }
  if (value < 5000) throw new Error("too small");
  return value;
}
function countOf(values: number[]): number {
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    try {
      count += check(values[i]);
    } catch {
      count += 1;
    }
  }
  return count;
}
const values: number[] = [];
for (let i = 0; i < operations; i++) values.push(i);
let total = 0;

kernel: {
  total += countOf(values);
}

console.log(total);
