// Flags: --aot-check=verify-each-pass
// As a-function-value-of-many-callees-called-in-a-callback-of-foreach-verified.ts, with seventy functions. What one function does is summed up from the functions it may call,
// up to a number of them. The function that has the arms for all places calls every one of the seventy, and a place keeps its test of the list across the call of that function.
type Task = () => number;

function runAllByForEach(tasks: Task[]): number {
  let total = 0;
  tasks.forEach(task => (total += task()));
  return total;
}

function runAllByForOf(tasks: Task[]): number {
  let total = 0;
  for (const task of tasks) if (task) total += task();
  return total;
}

const lists: Task[][] = [
  [() => 0, () => 1, () => 2, () => 3, () => 4, () => 5, () => 6, () => 7, () => 8, () => 9],
  [() => 10, () => 11, () => 12, () => 13, () => 14, () => 15, () => 16, () => 17, () => 18, () => 19],
  [() => 20, () => 21, () => 22, () => 23, () => 24, () => 25, () => 26, () => 27, () => 28, () => 29],
  [() => 30, () => 31, () => 32, () => 33, () => 34, () => 35, () => 36, () => 37, () => 38, () => 39],
  [() => 40, () => 41, () => 42, () => 43, () => 44, () => 45, () => 46, () => 47, () => 48, () => 49],
  [() => 50, () => 51, () => 52, () => 53, () => 54, () => 55, () => 56, () => 57, () => 58, () => 59],
  [() => 60, () => 61, () => 62, () => 63, () => 64, () => 65, () => 66, () => 67, () => 68, () => 69],
  new Array<Task>(3),
];
delete lists[0][1];
lists[1].length = 12;

for (const list of lists) console.log(runAllByForEach(list), runAllByForOf(list), list.length);
export {};
