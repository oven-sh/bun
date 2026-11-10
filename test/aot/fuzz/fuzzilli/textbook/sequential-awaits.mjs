function later(value) {
  return new Promise(resolve => setTimeout(resolve, 0, value));
}
async function total(values) {
  let sum = 0;
  for (const value of values) sum += await later(value);
  return sum;
}
console.log(await total([1, 2, 3]));
