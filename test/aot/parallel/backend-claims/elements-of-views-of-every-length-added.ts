// The elements of a view are added up in a loop, for views of 0 to 40 elements that lie at the head of one buffer of 64.
function sum(view: Int32Array): number {
  let total = 0;
  for (let i = 0; i < view.length; i++) total = (total + view[i]) | 0;
  return total;
}
const whole = new Int32Array(64).map((_, at) => at + 1);
const said: number[] = [];
for (let length = 0; length <= 40; length++) said.push(sum(whole.subarray(0, length)));
console.log(said.join());
