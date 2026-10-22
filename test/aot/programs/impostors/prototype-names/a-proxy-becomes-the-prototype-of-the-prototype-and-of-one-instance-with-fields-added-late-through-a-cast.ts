// A Proxy is hung above the prototype of a class, and another one directly above one instance.
// Every read, `in` test and store that finds the slot empty must reach the traps, with the instance as the receiver; a filled slot must not.
// In this twin the class declares only what its constructor stores: the other fields are added late, through a cast to an interface.
interface RecordShape {
  id: number;
  memo?: number;
}
const Record_ = class {
  declare id: number;
  constructor(id: number) {
    this.id = id;
  }
};
const log: string[] = [];
function traps(name: string): ProxyHandler<object> {
  return {
    get(target, key, receiver) {
      if (typeof key === "string") log.push(`${name} get ${key} for ${(Object.getOwnPropertyDescriptor(receiver, "id") ?? {}).value}`);
      return key === "memo" ? 500 : Reflect.get(target, key, receiver);
    },
    has(target, key) {
      log.push(`${name} has ${String(key)}`);
      return key === "memo" || Reflect.has(target, key);
    },
    set(target, key, value, receiver) {
      log.push(`${name} set ${String(key)} = ${value}`);
      return value > 100 ? Reflect.defineProperty(receiver, key, { value, writable: true, enumerable: true, configurable: true }) : true;
    },
  };
}
function read(record: RecordShape) {
  return record.memo;
}
function write(record: RecordShape, value: number) {
  record.memo = value;
}
function has(record: RecordShape) {
  return "memo" in record;
}
function flush() {
  const text = log.join(", ");
  log.length = 0;
  return text;
}

let sum = 0;
for (let i = 0; i < 3000; i++) {
  const record = new Record_(i) as RecordShape;
  sum += (read(record) ?? 1) + (has(record) ? 1 : 0);
  if (i & 1) write(record, 3);
  sum += (read(record) ?? 1) + (has(record) ? 1 : 0);
}
console.log("warm", sum);

const empty = new Record_(1) as RecordShape;
const filled = new Record_(2) as RecordShape;
write(filled, 20);
Object.setPrototypeOf(Record_.prototype, new Proxy({}, traps("above")));
flush();
console.log("reads:", read(empty), read(filled), read((new Record_(3) as RecordShape)), "|", flush());
console.log("in:", has(empty), has(filled), "|", flush());
write(empty, 5);
console.log("a store that the trap swallows:", Object.keys(empty).join(), read(empty), "|", flush());
write(empty, 105);
console.log("a store that the trap defines:", Object.keys(empty).join(), read(empty), "|", flush());
write(filled, 21);
console.log("a store to a filled slot:", read(filled), "|", flush());
Object.setPrototypeOf(Record_.prototype, Object.prototype);
const plain = new Record_(4) as RecordShape;
console.log("the link is put back:", read(plain), has(plain), "|", flush());

const single = new Record_(5) as RecordShape;
const neighbor = new Record_(6) as RecordShape;
Object.setPrototypeOf(single, new Proxy(Record_.prototype, traps("single")));
flush();
console.log("one instance:", read(single), read(neighbor), has(single), has(neighbor), "|", flush());
write(single, 6);
write(neighbor, 7);
console.log("stores:", Object.keys(single).join(), Object.keys(neighbor).join(), "|", flush());
