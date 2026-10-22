// For contrast with ordinary names: the optional members of these instances have a symbol key, the keys "0" and "7", and the keys "1e3" and "-1", which only look like numbers.
// Members under the same keys arrive on the prototype, as values and as accessors.
const log: string[] = [];
const mark = Symbol("mark");
interface Slots {
  id: number;
  [mark]?: number;
  0?: string;
  7?: string;
  "1e3"?: string;
  "-1"?: string;
}
class Bag implements Slots {
  declare id: number;
  declare [mark]?: number;
  declare 0?: string;
  declare 7?: string;
  declare "1e3"?: string;
  declare "-1"?: string;
  constructor(id: number) {
    this.id = id;
  }
}
function look(bag: Bag) {
  return `${bag[mark]} ${bag[0]} ${bag[7]} ${bag["1e3"]} ${bag["-1"]} ${(bag as any)[1e3]}`;
}
function fill(bag: Bag) {
  bag[mark] = 1;
  bag[0] = "zero";
  bag["1e3"] = "text";
  bag["-1"] = "minus";
}
function own(bag: Bag) {
  return `[${Reflect.ownKeys(bag).map(String)}]`;
}

let length = 0;
for (let i = 0; i < 3000; i++) {
  const bag = new Bag(i);
  length += look(bag).length;
  if (i & 1) fill(bag);
  length += look(bag).length;
}
console.log("warm", length);

const empty = new Bag(1);
const filled = new Bag(2);
fill(filled);
const holder: any = Bag.prototype;
const keys: PropertyKey[] = [mark, 0, 7, "1e3", "-1", 1000];
for (const key of keys) holder[key] = typeof key === "symbol" ? 99 : "inherited " + String(key);
console.log("values:", look(empty), own(empty), "|", look(filled), own(filled), "|", look(new Bag(3)));
for (const key of keys) {
  Object.defineProperty(holder, key, {
    get() {
      return typeof key === "symbol" ? 77 : "got " + String(key);
    },
    set(this: Bag, value: unknown) {
      log.push(`set ${String(key)} = ${String(value)} on ${this.id}`);
    },
    configurable: true,
  });
}
console.log("accessors:", look(empty), own(empty), "|", look(filled), own(filled));
fill(empty);
fill(filled);
console.log("stores:", look(empty), own(empty), "|", look(filled), own(filled));
console.log(log.join(", "));
for (const key of keys) delete holder[key];
console.log("gone again:", look(empty), own(empty), "|", look(filled), own(filled));
fill(empty);
console.log("filled:", look(empty), own(empty));
