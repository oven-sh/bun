// Between the two halves of one operation the object changes its layout: the right side of a store, the argument of a method call, a getter or a conversion deletes, adds or redefines the field that the operation is about.
class Cell {
  value = 1;
  other = "other";
  twice(by: number): number {
    return this.value * by;
  }
}

function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}
function state(cell: Cell): string {
  return JSON.stringify(cell) + " " + Object.keys(cell).join();
}

function storeResultOf(cell: Cell, change: (cell: any) => number): void {
  cell.value = change(cell);
}
function addResultOf(cell: Cell, change: (cell: any) => number): number {
  return (cell.value += change(cell));
}
function callWithResultOf(cell: Cell, change: (cell: any) => number): number {
  return cell.twice(change(cell));
}
function readAroundCall(cell: Cell, change: (cell: any) => number): string {
  return cell.value + "," + change(cell) + "," + cell.value + "," + cell.other;
}
function incrementConverted(cell: Cell): number {
  return cell.value++;
}

const changes: [string, (cell: any) => number][] = [
  ["nothing", () => 5],
  ["deletes it", cell => (delete cell.value, 5)],
  ["deletes the other", cell => (delete cell.other, 5)],
  ["deletes it and adds it behind", cell => (delete cell.value, (cell.late = 0), (cell.value = 40), 5)],
  ["adds fields", cell => ((cell.a = 1), (cell.b = 2), (cell.c = 3), (cell.d = 4), (cell.e = 5), (cell.f = 6), (cell.g = 7), 5)],
  ["makes it a getter", cell => (Object.defineProperty(cell, "value", { get: () => 70, set() {}, configurable: true, enumerable: true }), 5)],
  ["makes it read-only", cell => (Object.defineProperty(cell, "value", { writable: false }), 5)],
  ["freezes", cell => (Object.freeze(cell), 5)],
  ["stores a text", cell => ((cell.value = "text"), 5)],
  ["replaces the method on it", cell => ((cell.twice = () => -1), 5)],
  ["exchanges the prototype", cell => (Object.setPrototypeOf(cell, { twice: () => -2, value: -3 }), 5)],
  ["exchanges the prototype and deletes it", cell => (Object.setPrototypeOf(cell, { twice: () => -2, value: -3 }), delete cell.value, 5)],
  ["collects", () => (Bun.gc(true), 5)],
  ["throws", () => {
    throw new RangeError("midway");
  }],
];

for (const [name, change] of changes) {
  const stored = new Cell();
  const added = new Cell();
  const called = new Cell();
  const read = new Cell();
  console.log(name + ":");
  console.log("  store:", attempt(() => storeResultOf(stored, change)), state(stored));
  console.log("  add:", attempt(() => addResultOf(added, change)), state(added));
  console.log("  call:", attempt(() => callWithResultOf(called, change)), state(called));
  console.log("  read:", attempt(() => readAroundCall(read, change)), state(read));
}

const converted = new Cell();
(converted as any).value = {
  valueOf() {
    delete (converted as any).value;
    (converted as any).first = "first";
    return 8;
  },
};
console.log("increment of an object that deletes the field:", attempt(() => incrementConverted(converted)), state(converted));

const replaced = new Cell();
(replaced as any).value = {
  valueOf() {
    Object.defineProperty(replaced, "value", { set() {}, get: () => "getter", configurable: true });
    return 8;
  },
};
console.log("increment of an object that makes the field an accessor:", attempt(() => incrementConverted(replaced)), attempt(() => replaced.value));

export {};
