// Object.prototype is above every class. Plain Bun lets a program add the name of an optional field to it, and every empty slot inherits.
// Under --aot Object.prototype is locked: each of the seven ways to add the name is refused and nothing is inherited. The .expected.txt and .erased.txt hold that answer.
const log: string[] = [];
class Links {
  declare id: number;
  declare resolved?: number;
  constructor(id: number) {
    this.id = id;
  }
}
class Deeper extends Links {
  declare other?: number;
}
function read(links: Links) {
  return links.resolved;
}
function write(links: Links, value: number) {
  links.resolved = value;
}
function state(links: Links) {
  return `${read(links)} ${"resolved" in links} ${Object.hasOwn(links, "resolved")}`;
}
const top: any = Object.getPrototypeOf(Object.getPrototypeOf(new Links(0)));
const accessors: PropertyDescriptor = {
  get() {
    return 8;
  },
  set(value: number) {
    log.push("set " + value);
  },
  configurable: true,
};
const ways: [string, () => unknown][] = [
  ["a store", () => (top.resolved = 1)],
  ["a store under a computed key", () => (top[["res", "olved"].join("")] = 2)],
  ["Object.defineProperty", () => typeof Object.defineProperty(top, "resolved", accessors)],
  ["Reflect.defineProperty", () => Reflect.defineProperty(top, "resolved", accessors)],
  ["Reflect.set", () => Reflect.set(top, "resolved", 5)],
  ["Object.assign", () => typeof Object.assign(top, { resolved: 6 })],
  ["evaluated text", () => (0, eval)("Object.prototype.resolved = 7")],
];

let sum = 0;
for (let i = 0; i < 3000; i++) {
  const links = i & 1 ? new Links(i) : new Deeper(i);
  sum += read(links) ?? 1;
  if (i & 2) write(links, 2);
  sum += read(links) ?? 1;
}
console.log("warm", sum);

const empty = new Links(1);
const deep = new Deeper(2);
const filled = new Links(3);
write(filled, 30);
for (const [label, change] of ways) {
  let outcome: string;
  try {
    outcome = String(change());
  } catch (error) {
    outcome = (error as Error).constructor.name;
  }
  const fresh = new Deeper(4);
  const seen = [empty, deep, filled, fresh].map(state).join(" | ");
  write(fresh, 40);
  console.log(`${label}: ${outcome} -> ${seen} -> ${state(fresh)} ${log.join()}`);
  log.length = 0;
  delete top.resolved;
  console.log(`  cleaned up: ${[empty, deep, filled, new Deeper(5)].map(state).join(" | ")}`);
}
