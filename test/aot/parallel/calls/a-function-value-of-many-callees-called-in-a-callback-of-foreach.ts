// forEach tests the form of the list once and looks for each element behind that test. Its callback calls a value that may be any of ten functions, and none of them writes to a list.
// The place keeps the test across that call, whichever way the call is made: the verifier stops the build where something in between may have run any code.
type Task = () => number;

function runAllByForEach(tasks: Task[]): number {
  let total = 0;
  tasks.forEach(task => (total += task()));
  return total;
}

function runAll(tasks: Task[]): number {
  let total = 0;
  for (let index = 0; index < tasks.length; index++) if (index in tasks) total += tasks[index]();
  return total;
}

const renamed: Task = () => 11;
Object.defineProperty(renamed, "name", { value: "another name" });
const withProperty: Task & { note?: string } = () => 12;
withProperty.note = "a property";

const lists: Task[][] = [
  [() => 1, () => 2, () => 3],
  [() => 4, () => 5, () => 6],
  [() => 7, () => 8, () => 9, () => 10],
  [renamed, withProperty],
  new Array<Task>(3),
];
delete lists[0][1];
lists[1].length = 5;
lists[2][6] = () => 0.5;

for (const list of lists) console.log(runAllByForEach(list), runAll(list), list.length);
export {};
