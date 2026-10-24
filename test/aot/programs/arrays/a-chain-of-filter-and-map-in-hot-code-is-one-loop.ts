// `xs.filter(f).map(g).length` in a function that runs often, over an array that only the program holds, with callbacks that write nothing: the chain is one walk of the array.
// STATISTIC: ArrayChainsFused >= 1
function chain(xs: number[]): number {
  const doubled = xs.filter(x => x > 0).map(x => x * 2);
  return doubled.length;
}

const n = process.argv.length & 1;
const source = [n + 1, n - 2, n + 3, n - 4, n + 5];
let total = 0;
for (let k = 0; k < 20000; k++) total = (total + chain(source)) | 0;
console.log(total);
