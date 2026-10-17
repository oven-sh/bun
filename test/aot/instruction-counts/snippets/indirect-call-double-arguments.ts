// calls a function of three numbers through a value that says nothing about it, with fractions
function sumOfThree(a: number, b: number, c: number): number {
  return a + b + c;
}
function productOfThree(a: number, b: number, c: number): number {
  return a * b * c;
}
const operations = 100;
const functions: Record<string, Function> = { sumOfThree, productOfThree };
const called = functions[process.argv.length > 50 ? "productOfThree" : "sumOfThree"];
let total = 0;

kernel: {
  let sum = 0;
  for (let i = 0; i < operations; i++) sum += called(i + 0.5, 1.25, 2.125);
  total += sum;
}

console.log(total);
