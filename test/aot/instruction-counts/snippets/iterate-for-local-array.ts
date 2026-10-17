// adds up an array of numbers ten times with a for loop in the function that made the array
const operations = 1000;
function sumOfNumbersMadeHere(): number {
  const numbers: number[] = [];
  for (let i = 0; i < 100; i++) numbers.push(i * 0.5);
  let sum = 0;
  for (let pass = 0; pass < 10; pass++) {
    for (let i = 0; i < numbers.length; i++) sum += numbers[i];
  }
  return sum;
}
let total = 0;

kernel: {
  total += sumOfNumbersMadeHere();
}

console.log(total);
