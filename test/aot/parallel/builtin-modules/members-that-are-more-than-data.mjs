// Three members that are more than the data they look like: a store to process.ppid defines a property on its receiver, Module.wrapper is new at each read, console replaces its own async iterator. And Buffer.prototype.parent answers what the receiver holds.
import Module from "node:module";
const { set } = Object.getOwnPropertyDescriptor(process, "ppid");
function define(receiver) {
  const holder = { value: 0 };
  const proxy = new Proxy(receiver, {
    defineProperty(target, key, descriptor) {
      holder.value++;
      return Reflect.defineProperty(target, key, descriptor);
    },
  });
  let outcome = "stored";
  try {
    set.call(proxy, 5);
  } catch (error) {
    outcome = "threw " + error.name;
  }
  return `${holder.value} ${outcome} ${receiver.ppid}`;
}
console.log(typeof set, define({}), define(Object.freeze({})));
function inherited() {
  const child = Object.freeze(Object.create(process));
  try {
    child.ppid = 1;
    return "stored";
  } catch (error) {
    return "threw " + error.name;
  }
}
console.log(inherited());

function twice() {
  const first = Module.wrapper;
  const second = Module.wrapper;
  return `${first === second} ${first[0] === second[0]} ${first.length}`;
}
function inLoop() {
  const seen = new Set();
  for (let index = 0; index < 4; index++) seen.add(Module.wrapper);
  return seen.size;
}
console.log(twice(), inLoop());

function replaced() {
  const before = console[Symbol.asyncIterator];
  const iterator = console[Symbol.asyncIterator]();
  const after = console[Symbol.asyncIterator];
  return `${before === after} ${typeof after} ${typeof iterator.next}`;
}
console.log(replaced());

function parent() {
  const bytes = new ArrayBuffer(8);
  const buffer = Buffer.from(bytes);
  const answer = buffer.parent;
  new Uint8Array(answer)[0] = 7;
  return `${answer === bytes} ${buffer[0]} ${new Uint8Array(bytes)[0]}`;
}
console.log(parent());
const getter = Object.getOwnPropertyDescriptor(Buffer.prototype, "parent").get;
const held = { tag: 1 };
console.log(getter.call({ buffer: held }) === held, getter.call(new Uint8Array(1)) instanceof ArrayBuffer);

function store(value) {
  let outcome = "nothing";
  try {
    process.ppid = value;
    outcome = "stored";
  } catch (error) {
    outcome = "threw " + error.name;
  }
  return outcome;
}
console.log(store(1), process.ppid);
Object.freeze(process);
console.log(store(2), process.ppid);
