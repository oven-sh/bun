// An instance can leave the state it was born in: extra properties, indexed ones, a deleted field, a value of another kind, frozen, sealed, used as a prototype, and so on.
// Instances are brought into fourteen states, some before and some after the prototype gets the name. In every state an empty slot must inherit and a first store must call the setter.
// In this twin the optional fields are class fields without `declare`: they are defined at birth and the constructor deletes them, so the slots are declared and empty. Every instance may reach unknown code.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
const log: string[] = [];
class Thing {
  declare id: number;
  declare size: number;
  link?: number;
  constructor(id: number) {
    delete this.link;
    handOver(this);
    this.id = id;
    this.size = 1;
  }
}
function linkOf(thing: Thing) {
  return thing.link;
}
function setLink(thing: Thing, value: number) {
  thing.link = value;
}
const states: [string, (thing: any) => void][] = [
  ["as born", () => {}],
  ["one extra property", thing => (thing.extra = 1)],
  ["a hundred extra properties", thing => { for (let i = 0; i < 100; i++) thing["p" + i] = i; }],
  ["indexed properties", thing => { thing[0] = "a"; thing[5] = "b"; }],
  ["a symbol property", thing => (thing[Symbol.for("s")] = 1)],
  ["a deleted field", thing => delete thing.size],
  ["a value of another kind", thing => (thing.size = "large")],
  ["a hidden field", thing => Object.defineProperty(thing, "size", { enumerable: false })],
  ["an own accessor for another field", thing => Object.defineProperty(thing, "size", { get: () => 2, configurable: true })],
  ["frozen", thing => Object.freeze(thing)],
  ["sealed", thing => Object.seal(thing)],
  ["not extensible", thing => Object.preventExtensions(thing)],
  ["a prototype of something", thing => Object.create(thing)],
  ["away from its prototype and back", thing => { Object.setPrototypeOf(thing, {}); Object.setPrototypeOf(thing, Thing.prototype); }],
];
function probe(thing: Thing) {
  const read = linkOf(thing);
  const has = "link" in thing;
  let stored: string;
  try {
    setLink(thing, 8);
    stored = "stored";
  } catch (error) {
    stored = (error as Error).constructor.name;
  }
  const calls = log.length;
  log.length = 0;
  return `${read} ${has} ${stored} ${calls} ${linkOf(thing)} ${Object.hasOwn(thing, "link")}`;
}
function prepare(base: number) {
  return states.map(([, change], index) => {
    const thing = new Thing(base + index);
    change(thing);
    return thing;
  });
}
function report(title: string, things: Thing[]) {
  console.log(title);
  things.forEach((thing, index) => console.log("  " + states[index][0] + ": " + probe(thing)));
}

let sum = 0;
for (let i = 0; i < 3000; i++) {
  const thing = new Thing(i);
  sum += linkOf(thing) ?? 1;
  if (i & 1) setLink(thing, 2);
  sum += linkOf(thing) ?? 1;
}
console.log("warm", sum);

report("nothing is inherited", prepare(0));
const changedBefore = prepare(100);
const bornBefore = states.map((_, index) => new Thing(200 + index));
Object.defineProperty(Reflect.getPrototypeOf(bornBefore[0])!, ["l", "i", "n", "k"].join(""), {
  get() {
    return 70;
  },
  set(this: Thing, value: number) {
    log.push("set " + value);
  },
  configurable: true,
});
report("brought into the state before the accessors came", changedBefore);
bornBefore.forEach((thing, index) => states[index][1](thing));
report("born before, brought into the state afterwards", bornBefore);
report("born afterwards", prepare(300));
delete (Thing.prototype as any).link;
report("the accessors are gone", prepare(400));
