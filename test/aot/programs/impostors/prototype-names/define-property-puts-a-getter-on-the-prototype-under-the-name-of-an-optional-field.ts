// Object.defineProperty puts a getter without a setter on the prototype under the name of an optional field.
// Reads of an empty slot must run it with the instance as `this`; a strict store to an empty slot must throw.
class Entry {
  declare id: number;
  declare size?: number;
  constructor(id: number) {
    this.id = id;
  }
}
const log: string[] = [];
function read(entry: Entry) {
  return entry.size;
}
function write(entry: Entry, value: number) {
  entry.size = value;
}
function attempt(entry: Entry, value: number) {
  try {
    write(entry, value);
    return "stored";
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
function describe(entry: Entry) {
  return `${read(entry)} ${"size" in entry} ${entry.hasOwnProperty("size")} [${Object.keys(entry)}]`;
}
function readDefineRead(entry: Entry, holder: object, name: string) {
  const before = entry.size;
  Object.defineProperty(holder, name, {
    get(this: Entry) {
      log.push("get on " + this.id);
      return this.id * 100;
    },
    configurable: true,
  });
  return `${before} ${entry.size}`;
}

let sum = 0;
for (let i = 0; i < 3000; i++) {
  const entry = new Entry(i);
  sum += read(entry) ?? 1;
  if (i % 3 === 0) write(entry, 2);
  sum += read(entry) ?? 1;
}
console.log("warm", sum);

const empty = new Entry(1);
const filled = new Entry(2);
write(filled, 20);
console.log("before:", describe(empty), "|", describe(filled));
console.log("around the definition:", readDefineRead(empty, Entry.prototype, "size"));
const fresh = new Entry(3);
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
