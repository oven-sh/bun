// A method replaces itself on its prototype on its first run and then calls itself by name: the call inside finds the replacement, and so does every later call. An override does the same through super. One number is printed.
class Task {
  runs = 0;
  step(): number {
    Task.prototype.step = function () {
      return ++this.runs * 10;
    };
    return this.step() + 1;
  }
}
class Slow extends Task {
  step(): number {
    Slow.prototype.step = function () {
      return ++this.runs * 1000;
    };
    return super.step() + this.step() + 2;
  }
}
class Idle extends Task {}

function stepOf(task: Task): number {
  return task.step();
}

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

const tasks: Task[] = [new Slow(), new Idle(), new Task(), new Slow()];
for (let round = 0; round < 3; round++) for (const task of tasks) note(stepOf(task));
for (const task of tasks) note(task.runs);
console.log(checksum);

export {};
