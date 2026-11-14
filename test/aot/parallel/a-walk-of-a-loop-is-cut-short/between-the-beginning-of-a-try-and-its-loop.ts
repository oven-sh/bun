// The loop of `fill` is copied into the loop around it. Where the walk of the loop around was cut short at an operation built in front of the head of the loop within, the compiler died.
// Under: --aot-testing=AbortLoopVisits:7:0: without the word no walk of these loops is cut short there
function fill(list: number[], n: number): number[] {
  for (let i = 0; i < n; i++) list[i] = i;
  return list;
}
let total = 0;
for (let round = 0; round < 50; round++) total += fill([], round % 5).length;
console.log(total);
