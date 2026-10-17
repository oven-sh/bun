// a function drives a generator it is given: next(value) in a loop, done and value read from each result
class Task {
  readonly cost: number;
  constructor(cost: number) {
    this.cost = cost;
  }
}
function* tasks(steps: number): Generator<Task, number, number> {
  let sum = 0;
  for (let n = 0; n < steps; n++) sum += yield new Task(n);
  return sum;
}
function drive(program: Generator<Task, number, number>): number {
  let step = program.next(0);
  while (!step.done) step = program.next(step.value.cost * 2);
  return step.value;
}
const operations = 100;
const kept: Generator<Task, number, number>[] = [];
let total = 0;

kernel: {
  kept[0] = tasks(operations);
  total += drive(kept[0]);
}

console.log(total);
