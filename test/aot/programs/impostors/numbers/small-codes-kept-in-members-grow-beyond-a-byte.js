function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return Object.prototype.toString.call(value);
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function outcome(run) {
  try {
    return show(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

function attempt(label, run) {
  console.log(label, "->", outcome(run));
}

class Task {
  constructor() {
    this.state = 0;
    this.done = false;
    this.priority = 1;
    this.ratio = 0.5;
  }
  start() {
    this.state = 1;
  }
  finish() {
    this.state = 2;
    this.done = true;
  }
  raise() {
    this.priority = this.priority === 3 ? 3 : this.priority + 1;
  }
  report() {
    return [this.state, this.done, this.priority, this.ratio, this.state + 1, this.state * 2, this.state & 255, this.state === 2, typeof this.state];
  }
}

function put(task, name, value) {
  task[name] = value;
}

const tasks = [];
for (let i = 0; i < 2000; i++) {
  const task = new Task();
  task.start();
  if (i & 1) task.finish();
  task.raise();
  task.report();
  if (i < 4) tasks.push(task);
}
attempt("honest tasks", () => tasks.map(task => task.report()));

for (const value of [3, 127, 128, 129, 255, 256, 257, 32767, 32768, 65535, 65536, 16777216, 16777217, 2147483647, -1, -127, -128, -129, -32768, -32769, -2147483648, 0.5, 0.1, -0, NaN, Infinity, 1e39, true, false, null, undefined, "1", 1n]) {
  const label = show(value);
  attempt("state = " + label, () => {
    const task = new Task();
    put(task, "state", value);
    return task.report();
  });
  attempt("done = " + label, () => {
    const task = new Task();
    put(task, "done", value);
    return [task.done, typeof task.done, task.done ? "truthy" : "falsy", task.done === true, task.done === false];
  });
  attempt("ratio = " + label, () => {
    const task = new Task();
    put(task, "ratio", value);
    return [task.ratio, typeof task.ratio, task.ratio * 2, task.ratio === value, Object.is(task.ratio, value)];
  });
  attempt("priority = " + label + " and raise", () => {
    const task = new Task();
    put(task, "priority", value);
    task.raise();
    return task.priority;
  });
}
attempt("honest tasks afterwards", () => tasks.map(task => task.report()));
