// A setter without a getter arrives on the prototype under the name of an optional field.
// A first store must call it and must not fill the slot; an instance that has the field already keeps storing to its own.
// In this twin the class declares only what its constructor stores: the other fields are added late, through a cast to an interface.
interface TaskShape {
  id: number;
  owner?: string;
  done?: boolean;
}
class Task {
  declare id: number;
  constructor(id: number) {
    this.id = id;
  }
}
const log: string[] = [];
function read(task: TaskShape) {
  return task.owner;
}
function write(task: TaskShape, value: string) {
  task.owner = value;
}
function describe(task: TaskShape) {
  return `${read(task)} ${"owner" in task} ${Object.hasOwn(task, "owner")} [${Object.keys(task)}]`;
}
function storeDefineStore(first: TaskShape, second: TaskShape, holder: object, name: string) {
  first.owner = "before";
  Object.defineProperty(holder, name, {
    set(this: TaskShape, value: string) {
      log.push(`set ${value} on ${this.id}`);
    },
    configurable: true,
  });
  second.owner = "after";
}

let count = 0;
for (let i = 0; i < 3000; i++) {
  const task = new Task(i) as TaskShape;
  if (read(task) === undefined) count++;
  write(task, "o" + (i & 3));
  count += read(task)!.length;
}
console.log("warm", count);

const first = new Task(1) as TaskShape;
const second = new Task(2) as TaskShape;
const third = new Task(3) as TaskShape;
storeDefineStore(first, second, Task.prototype, "owner");
console.log("around the definition:", describe(first), "|", describe(second));
const fresh = new Task(4) as TaskShape;
write(first, "again");
write(third, "third");
write(fresh, "fresh");
console.log("stores:", describe(first), "|", describe(third), "|", describe(fresh));
console.log(log.join(", "));
log.length = 0;
for (let i = 0; i < 5; i++) write((new Task(10 + i) as TaskShape), "n" + i);
console.log(log.join(", "));
log.length = 0;
delete first.owner;
write(first, "once more");
console.log("own one deleted, then stored:", describe(first), log.join(", "));
log.length = 0;
delete (Task.prototype as any).owner;
write(second, "at last");
write(fresh, "at last");
console.log("gone again:", describe(second), "|", describe(fresh), "|", describe((new Task(5) as TaskShape)), log.length);
