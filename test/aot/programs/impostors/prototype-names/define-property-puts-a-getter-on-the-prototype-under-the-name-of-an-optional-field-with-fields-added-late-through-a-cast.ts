// Object.defineProperty puts a getter without a setter on the prototype under the name of an optional field.
// Reads of an empty slot must run it with the instance as `this`; a strict store to an empty slot must throw.
// In this twin the class declares only what its constructor stores: the other fields are added late, through a cast to an interface.
interface EntryShape {
  id: number;
  size?: number;
}
const Entry = class {
  declare id: number;
  constructor(id: number) {
    this.id = id;
  }
};
const log: string[] = [];
function read(entry: EntryShape) {
  return entry.size;
}
function write(entry: EntryShape, value: number) {
  entry.size = value;
}
function attempt(entry: EntryShape, value: number) {
  try {
    write(entry, value);
    return "stored";
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
function describe(entry: EntryShape) {
  return `${read(entry)} ${"size" in entry} ${entry.hasOwnProperty("size")} [${Object.keys(entry)}]`;
}
function readDefineRead(entry: EntryShape, holder: object, name: string) {
  const before = entry.size;
  Object.defineProperty(holder, name, {
    get(this: EntryShape) {
      log.push("get on " + this.id);
      return this.id * 100;
    },
    configurable: true,
  });
  return `${before} ${entry.size}`;
}

let sum = 0;
for (let i = 0; i < 3000; i++) {
  const entry = new Entry(i) as EntryShape;
  sum += read(entry) ?? 1;
  if (i % 3 === 0) write(entry, 2);
  sum += read(entry) ?? 1;
}
console.log("warm", sum);

const empty = new Entry(1) as EntryShape;
const filled = new Entry(2) as EntryShape;
write(filled, 20);
console.log("before:", describe(empty), "|", describe(filled));
console.log("around the definition:", readDefineRead(empty, Entry.prototype, "size"));
const fresh = new Entry(3) as EntryShape;
console.log("a getter:", describe(empty), "|", describe(filled), "|", describe(fresh));
console.log("stores:", attempt(empty, 5), attempt(filled, 6), attempt(fresh, 7));
console.log("after the stores:", describe(empty), "|", describe(filled), "|", describe(fresh));
console.log(log.join(", "));
log.length = 0;
Object.defineProperty(empty, "size", { value: 8, writable: true, enumerable: true, configurable: true });
console.log("defined on the instance:", describe(empty), attempt(empty, 9), describe(empty));
delete (Entry.prototype as any).size;
console.log("gone again:", describe(empty), "|", describe(fresh), "|", attempt(fresh, 10), describe(fresh));
console.log(log.join(", "));
