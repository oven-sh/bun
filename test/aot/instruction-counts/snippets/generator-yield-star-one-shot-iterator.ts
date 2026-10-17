// a driver resumes a generator whose every step is yield* over an object with a one-shot iterator
class OneShot<T> implements Iterator<Task<T>, T, T> {
  private value: Task<T> | T;
  private done = false;
  constructor(task: Task<T>) {
    this.value = task;
  }
  next(sent: T): IteratorResult<Task<T>, T> {
    if (this.done) return { value: sent, done: true };
    this.done = true;
    return { value: this.value as Task<T>, done: false };
  }
}
class Task<T> {
  readonly result: T;
  constructor(result: T) {
    this.result = result;
  }
  [Symbol.iterator](): OneShot<T> {
    return new OneShot(this);
  }
}
function* program(steps: number): Generator<Task<number>, number, number> {
  let sum = 0;
  for (let n = 0; n < steps; n++) sum += yield* new Task(n);
  return sum;
}
function drive(steps: Generator<Task<number>, number, number>): number {
  let sent = 0;
  for (;;) {
    const state = steps.next(sent);
    if (state.done) return state.value;
    sent = state.value.result;
  }
}
const operations = 100;
let total = 0;

kernel: {
  total += drive(program(operations));
}

console.log(total);
