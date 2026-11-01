// The variable of a loop holds an array or a typed array. Every turn reads an element, and some turns replace the list by one of the other class or of another length.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
function work(first: number[] | Float64Array, second: number[] | Float64Array, n: number): number {
  let list = first;
  let sum = 0;
  for (let j = 0; j < n; j++) {
    const e = list[j & 7];
    sum = mix(sum, e === undefined ? -1000 : e);
    if ((j & 7) === 5) list = list === first ? second : first;
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i & 1 ? [i, 1, 2, 3, 4, 5, 6, 7] : new Float64Array([i, 1.5, 2.5]), i & 2 ? new Float64Array(8).fill(i) : [i, 0.5], 40));
console.log(total);
