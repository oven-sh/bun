// A field is made for one kind of value. A store by a computed key, a definition or an assignment of all properties puts another kind there, and every read must find it, in a spread copy too.
const lines = [];
const values = () => ["", 10n, 0, -0, 1, 0.5, NaN, true, false, null, undefined, {}, [], () => 2, Symbol.for("s"), "text"];
const show = value => `${typeof value} ${typeof value === "symbol" ? value.description : Object.is(value, -0) ? "-0" : String(value)}`;

function overMethodOfLiteral(y) {
  let o = Object.assign({}, { n() { return 1; } });
  [["n", y]].forEach(([key, value]) => { o[key] = value; });
  return `${typeof o["n"]} ${show(o["n"])} ${show(o.n)} ${"n" in o} ${Object.keys(o).join()}`;
}

function copyAfterAssignFromParsed(text) {
  let o = { f: () => 1, g: () => 2, h: () => 3, i: () => 4, j: () => 5 };
  Object.assign(o, JSON.parse(text));
  const copy = { ...o };
  return [{ ...o }.f, copy.f, copy.g, copy.h, copy.i, copy.j, o.f, o.j].map(value => (typeof value === "function" ? "function" : show(value))).join(" | ");
}

class Task {
  constructor(id) {
    this.id = id;
  }
  label() {
    return "method";
  }
}
Task.prototype.owner = null;
Task.prototype.done = false;
Task.prototype.tries = 3;
function fill(task, full) {
  if (full) {
    task.owner = { toString: () => "someone" };
    task.done = true;
    task.tries = 4;
    task.label = () => "own";
    task.note = "note";
    task.count = 7;
  }
  return task;
}
const names = ["owner", "done", "tries", "label", "note", "count"];
const showTask = task => [task.owner, task.done, task.tries, task.label, task.note, task.count].map(value => (typeof value === "function" ? "function" : show(value))).join(" | ");

const ways = {
  store(task, key, value) { task[key] = value; },
  define(task, key, value) { Object.defineProperty(task, key, { value, writable: true, enumerable: true, configurable: true }); },
  assign(task, key, value) { Object.assign(task, { [key]: value }); },
  reflect(task, key, value) { Reflect.set(task, key, value); },
  getter(task, key, value) { Object.defineProperty(task, key, { get: () => value, configurable: true }); },
  again(task, key, value) { task[key] = value; delete task[key]; task[key] = value; },
  gone(task, key, value) { task[key] = value; delete task[key]; },
};

for (let round = 0; round < 2; round++) {
  for (const value of values()) lines.push(`literal: ${overMethodOfLiteral(value)}`);
  for (const text of ['{"f":2}', '{"f":2,"g":true,"h":null,"i":"text","j":0.5}', '{"j":[]}', "{}"]) lines.push(`copy ${text}: ${copyAfterAssignFromParsed(text)}`);
  for (const [way, put] of Object.entries(ways)) {
    for (const full of [false, true]) {
      for (const value of values()) {
        const task = fill(new Task(1), full);
        for (const name of names) put(task, name, value);
        lines.push(`${way} ${full}: ${showTask(task)} # ${showTask(fill(new Task(2), full))}`);
      }
    }
  }
}
const seen = new Map();
for (const line of lines) seen.set(line, (seen.get(line) ?? 0) + 1);
console.log([...seen].map(([line, count]) => `${count} ${line}`).join("\n"));
