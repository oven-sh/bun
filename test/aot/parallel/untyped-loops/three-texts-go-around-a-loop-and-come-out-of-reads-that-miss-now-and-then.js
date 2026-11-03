// Three texts go around a loop that joins them in every turn. Each comes out of a list by a read that misses now and then: the turn behind a miss runs in the slow copy of the loop, and the loop goes on once all three are texts again.
function run(list, turns, step) {
  let first = "0", second = "0", third = "0";
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    sum += (first + second + third).length;
    first = list[i % 40];
    second = list[(i * step) % 40];
    third = list[(i + step) % 40];
  }
  return sum + " " + first + " " + second + " " + third;
}

const list = [];
for (let i = 0; i < 32; i++) list.push("s".repeat(1 + (i % 5)) + i);

console.log(run(list, 30, 1));
console.log(run(list, 4000, 1));
console.log(run(list, 4001, 7));
console.log(run(list, 37, 39));
console.log(run(list, 36, 3));
console.log(run([], 9, 1));
