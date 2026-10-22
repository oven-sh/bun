// A setter without a getter arrives on the prototype under the name of an optional field.
// A first store must call it and must not fill the slot; an instance that has the field already keeps storing to its own.
class Task {
  declare id: number;
  declare owner?: string;
  declare done?: boolean;
  constructor(id: number) {
    this.id = id;
  }
}
const log: string[] = [];
function read(task: Task) {
  return task.owner;
}
function write(task: Task, value: string) {
  task.owner = value;
}
function describe(task: Task) {
  return `${read(task)} ${"owner" in task} ${Object.hasOwn(task, "owner")} [${Object.keys(task)}]`;
}
function storeDefineStore(first: Task, second: Task, holder: object, name: string) {
  first.owner = "before";
  Object.defineProperty(holder, name, {
    set(this: Task, value: string) {
      log.push(`set ${value} on ${this.id}`);
    },
    configurable: true,
  });
  second.owner = "after";
}

let count = 0;
for (let i = 0; i < 3000; i++) {
  const task = new Task(i);
  if (read(task) === undefined) count++;
  write(task, "o" + (i & 3));
  count += read(task)!.length;
}
console.log("warm", count);

const first = new Task(1);
const second = new Task(2);
const third = new Task(3);
storeDefineStore(first, second, Task.prototype, "owner");
console.log("around the definition:", describe(first), "|", describe(second));
const fresh = new Task(4);
write(first, "again");
write(third, "third");
write(fresh, "fresh");
console.log("stores:", describe(first), "|", describe(third), "|", describe(fresh));
console.log(log.join(", "));
log.length = 0;
for (let i = 0; i < 5; i++) write(new Task(10 + i), "n" + i);
console.log(log.join(", "));
log.length = 0;
delete first.owner;
write(first, "once more");
console.log("own one deleted, then stored:", describe(first), log.join(", "));
log.length = 0;
delete (Task.prototype as any).owner;
write(second, "at last");
write(fresh, "at last");
console.log("gone again:", describe(second), "|", describe(fresh), "|", describe(new Task(5)), log.length);
