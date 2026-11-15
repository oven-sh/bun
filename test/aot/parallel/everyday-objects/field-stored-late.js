// A field that the constructor does not make is stored by a method, on some instances
class Task {
  constructor(name) {
    this.name = name;
  }
  start(at) {
    if (this.started === undefined) this.started = at;
    else this.started += at;
    return this;
  }
}
function run(first, at) {
  const tasks = [new Task(first), new Task(first + first), new Task(first)];
  for (let i = 0; i < tasks.length; i++) if (i !== 1) tasks[i].start(at).start(i);
  return tasks.map(task => Object.keys(task).join("+") + "=" + task.started).join(" ");
}
console.log(run("a", 1));
console.log(run("bb", 40));
console.log(run("", -7));
