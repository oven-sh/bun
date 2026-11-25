const values = JSON.parse("[3,-1,2,-5,4]").map(value => value * 1);
const output = new Array(values.length);
let best = undefined;
let sum = 0;
let i = values.length - 1;
do {
  best = Math.max(best, values[i]);
  output[i] = sum;
  i--;
} while (i >= 0);
console.log(best, output.join());
