// Every turn of a loop reads a list and a typed array out of constants of the module. Ahead of the declarations the loop is entered with no turns.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
function work(n: number): number {
  let sum = 0;
  for (let j = 0; j < n; j++) sum = mix(sum, list[j & 3]! + samples[j & 3]! + list.length + samples.length);
  return sum;
}
console.log(work(process.argv.length - 2));
const list = [process.argv.length, 5, 6, 7];
const samples = new Float64Array([process.argv.length, 1.5, 2.5, 3.5]);
console.log(work(40));
