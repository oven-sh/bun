// One function reads an optional field, reads a field of a second object, and reads or stores the optional field again. The read in the middle is an innocent read of a slot, 3000 times over.
// Then a definition that the build cannot attribute turns that field of one second object into an accessor, and the accessor puts the name on the prototype, on the base's prototype, hangs another object above the instance,
// or defines the field on the instance. What was tested for the first access no longer holds for the second.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
class Base {
  declare id: number;
  constructor(id: number) {
    this.id = id;
    handOver(this);
  }
}
class Links extends Base {
  declare resolved?: number;
  declare target?: string;
}
class Other {
  value = 1;
  constructor() {
    handOver(this);
  }
}
const log: string[] = [];
function readReadRead(links: Links, other: Other) {
  const before = links.resolved;
  const seen = other.value;
  return `${before} ${seen} ${links.resolved} ${"resolved" in links}`;
}
function readReadStore(links: Links, other: Other) {
  const before = links.resolved;
  const seen = other.value;
  links.resolved = seen + 10;
  return `${before} ${links.resolved} [${Object.keys(links)}]`;
}
function storeReadStore(links: Links, other: Other) {
  links.target = "first";
  const seen = other.value;
  links.resolved = seen + 20;
  return `${links.target} ${links.resolved} [${Object.keys(links)}]`;
}
function cleanUp() {
  delete (Links.prototype as any).resolved;
  delete (Base.prototype as any).resolved;
}
const accessors: PropertyDescriptor = {
  get() { return 70; },
  set(value: number) { log.push("set " + value); },
  configurable: true,
};
const effects: [string, (links: Links) => void][] = [
  ["nothing", () => {}],
  ["a value on the prototype", links => { Object.getPrototypeOf(links).resolved = 50; }],
  ["accessors on the prototype", links => { Object.defineProperty(Object.getPrototypeOf(links), "resolved", accessors); }],
  ["accessors on the base's prototype", () => { Object.defineProperty(Base.prototype, "resolved", accessors); }],
  ["a read-only value on the base's prototype", () => { Object.defineProperty(Base.prototype, "resolved", { value: 60, writable: false, configurable: true }); }],
  ["another prototype for the instance", links => { Object.setPrototypeOf(links, { resolved: 80 }); }],
  ["accessors on the instance", links => { Object.defineProperty(links, "resolved", accessors); }],
  ["a value on the instance", links => { (links as any).resolved = 90; }],
  ["the instance is closed", links => { Object.preventExtensions(links); }],
];
let length = 0;
for (let i = 0; i < 3000; i++) length += readReadRead(new Links(i), new Other()).length + readReadStore(new Links(i), new Other()).length + storeReadStore(new Links(i), new Other()).length;
console.log("warm", length);
const name: string = JSON.parse('"value"');
for (const [label, effect] of effects) {
  for (const run of [readReadRead, readReadStore, storeReadStore]) {
    const links = new Links(1), other = new Other();
    Object.defineProperty(other, name, { get() { effect(links); return 2; }, configurable: true });
    let outcome: string;
    try {
      outcome = run(links, other);
    } catch (error) {
      outcome = (error as Error).constructor.name;
    }
    console.log(`${label}, ${run.name}: ${outcome} | ${log.join()} | a neighbor: ${readReadRead(new Links(2), new Other())}`);
    log.length = 0;
    cleanUp();
  }
}
console.log("afterwards:", readReadStore(new Links(3), new Other()));
