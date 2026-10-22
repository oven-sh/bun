// A mixin whose accessor has a name computed at run time may, by its type, extend any class. It extends only classes that reach it as values. A class that is never used as a value keeps its `declare` fields in its layout.
// IR+ ^layout L[0-9]+ .*\{name="fiberNumber" declared=
// IR+ ^layout L[0-9]+ .*\{name="fiberLabel" declared=
function withAccessor<T extends new (...args: any[]) => any>(Base: T, name: string) {
  return class extends Base {
    get [name]() { return "from the mixin"; }
  };
}
class Extended { kept = 1; }
class Fiber {
  declare fiberNumber: number;
  declare fiberLabel: string;
  declare fiberNote: string | undefined;
  constructor(number: number) {
    this.fiberNumber = number;
    this.fiberLabel = "f" + number;
  }
  weight(): number { return this.fiberNumber + this.fiberLabel.length + (this.fiberNote === undefined ? 0 : 100); }
  annotate(note: string): void { this.fiberNote = note; }
}
const names = ["fiber", "Label"];
const Mixed = withAccessor(Extended, names.join(""));
const mixed = new Mixed() as unknown as Extended & { fiberLabel: string };
console.log(mixed.kept, mixed.fiberLabel, Object.keys(mixed).join(), "fiberLabel" in mixed, Object.hasOwn(mixed, "fiberLabel"));
let total = 0;
const fibers: Fiber[] = [];
for (let i = 0; i < 300; i++) {
  const fiber = new Fiber(i);
  if (i % 3 === 0) fiber.annotate("n");
  fibers.push(fiber);
  total += fiber.weight();
}
console.log(total, Object.keys(fibers[0]!).join(), Object.keys(fibers[1]!).join(), "fiberNote" in fibers[1]!, "fiberNote" in fibers[0]!, JSON.stringify(fibers[3]), fibers[2] instanceof Fiber);
