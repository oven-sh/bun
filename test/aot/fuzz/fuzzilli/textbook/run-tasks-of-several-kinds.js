class Job {
  constructor(id) {
    this.id = id;
    this.run = () => "ran " + id;
    this.done = false;
  }
}
class Delay {
  constructor(ms) {
    this.ms = ms;
  }
}
class Skip {
  constructor(reason) {
    this.reason = reason;
  }
}
function execute(task) {
  let out = "" + typeof task.run;
  if (typeof task !== "number" && task instanceof Job) out += " " + task.run();
  return out;
}
const tasks = [new Job(1), new Delay(5), new Skip("late"), new Job(2), 7];
for (let i = 0; i < tasks.length; i++) console.log(execute(tasks[i]));
