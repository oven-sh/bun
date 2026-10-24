// Object.defineProperty on single instances, under the name of a declared optional field whose slot is empty or filled: a getter, a setter, a read-only value, a hidden value, a fixed value.
// A slot cannot say any of that. Typed reads and stores on these instances must obey the definition, and their neighbors of the same class must go on as before.
const log: string[] = [];
class Gadget {
  declare id: number;
  declare power?: number;
  declare tag?: string;
  constructor(id: number) {
    this.id = id;
  }
}
function powerOf(gadget: Gadget) {
  return gadget.power;
}
function setPower(gadget: Gadget, value: number) {
  gadget.power = value;
}
function attempt(gadget: Gadget, value: number) {
  try {
    setPower(gadget, value);
    return "stored";
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
function state(gadget: Gadget) {
  const names: string[] = [];
  for (const name in gadget) names.push(name);
  return `${powerOf(gadget)} ${"power" in gadget} [${Object.keys(gadget)}] [${names}] ${JSON.stringify(gadget)} ${JSON.stringify(Object.getOwnPropertyDescriptor(gadget, "power"))}`;
}
const definitions: [string, PropertyDescriptor][] = [
  ["a getter", { get(this: Gadget) { log.push("get " + this.id); return 100 + this.id; }, enumerable: true, configurable: true }],
  ["a setter", { set(this: Gadget, value: number) { log.push(`set ${value} on ${this.id}`); }, enumerable: true, configurable: true }],
  ["a read-only value", { value: 7, writable: false, enumerable: true, configurable: true }],
  ["a hidden value", { value: 8, writable: true, enumerable: false, configurable: true }],
  ["a fixed value", { value: 9, writable: true, enumerable: true, configurable: false }],
  ["an ordinary value", { value: 10, writable: true, enumerable: true, configurable: true }],
  ["undefined", { value: undefined, writable: true, enumerable: true, configurable: true }],
  ["nothing but the name", {}],
];

let sum = 0;
for (let i = 0; i < 3000; i++) {
  const gadget = new Gadget(i);
  sum += powerOf(gadget) ?? 1;
  if (i & 1) setPower(gadget, 2);
  sum += powerOf(gadget) ?? 1;
}
console.log("warm", sum);

for (const start of ["an empty slot", "a filled slot"]) {
  for (const [label, descriptor] of definitions) {
    const gadget = new Gadget(1);
    const neighbor = new Gadget(2);
    if (start === "a filled slot") setPower(gadget, 5);
    gadget.tag = "t";
    Object.defineProperty(gadget, "power", descriptor);
    const defined = state(gadget);
    const stored = attempt(gadget, 6);
    const after = state(gadget);
    let deleted: string;
    try {
      deleted = String(delete gadget.power);
    } catch (error) {
      deleted = (error as Error).constructor.name;
    }
    const again = attempt(gadget, 4);
    console.log(`${label} over ${start}:\n  ${defined}\n  ${stored}: ${after}\n  delete ${deleted}, ${again}: ${state(gadget)}\n  ${log.join(", ")} | ${attempt(neighbor, 3)} ${state(neighbor)}`);
    log.length = 0;
  }
}
