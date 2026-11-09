// One object of a class gets an own property under the name of an accessor of the class, in the middle of a loop of reads and stores. The other objects go on with the accessor.
class Box {
  held: number;
  stores = 0;
  constructor(held: number) { this.held = held; }
  get size(): number { return this.held; }
  set size(value: number) { this.held = value; this.stores++; }
}

type Change = (target: object) => unknown;
const changes: [string, Change][] = [
  ["a data property defined by text that is evaluated", new Function("target", "Object.defineProperty(target, 'size', { value: 1000, writable: true, configurable: true })") as Change],
  ["an accessor defined by text that is evaluated", new Function("target", "let kept = 5; Object.defineProperty(target, 'size', { get() { return kept * 2 }, set(value) { kept = value % 7 }, configurable: true })") as Change],
  ["a getter without a setter", target => Object.defineProperty(target, "size", { get() { return 3; }, configurable: true })],
  ["Object.defineProperties", target => Object.defineProperties(target, { size: { value: 4, writable: false, configurable: true } })],
];

function use(box: Box, other: Box, change: () => void): string {
  let read = 0, readOther = 0, failures = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) change();
    read = (read + box.size) % 100003;
    readOther = (readOther + other.size) % 100003;
    try { box.size = i % 13; } catch { failures++; }
    other.size = i % 17;
  }
  return read + " " + readOther + " " + failures + " " + box.held + " " + box.stores + " " + other.held + " " + other.stores;
}

for (const [title, change] of changes) {
  const box = new Box(1), other = new Box(2);
  console.log(title);
  console.log("  before", use(box, other, () => {}));
  console.log("  during", use(box, other, () => { change(box); }));
  console.log("  after", use(box, other, () => {}));
  delete (box as { size?: unknown }).size;
  console.log("  deleted", use(box, other, () => {}));
}
