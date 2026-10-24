function Task(name) {
  this.name = name;
  this.done = null;
  this.then = null;
}
function run(task) {
  const done = task.done;
  return task.name + ":" + (typeof done === "function" ? done(task.name) : String(done)) + ":" + typeof task.then;
}
const tasks = [new Task("a"), new Task("b"), new Task("c"), new Task("d")];
let calls = 0;
tasks[0].done = function (name) { calls++; return name + "!"; };
tasks[1].done = name => { calls++; return name + "?" + tasks.length; };
tasks[1].then = () => calls;
console.log(tasks.map(run).join(" "), calls);
tasks[0].done = 5;
tasks[1].done = "text";
tasks[1].then = true;
tasks[2].done = tasks[3];
console.log(tasks.map(run).join(" ").replace("[object Object]", "d"), calls);
delete tasks[1].then;
console.log(tasks.map(run).join(" ").replace("[object Object]", "d"), Object.keys(tasks[1]).join());
