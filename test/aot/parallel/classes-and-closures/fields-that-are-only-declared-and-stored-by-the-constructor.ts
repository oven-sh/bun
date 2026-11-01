// STATISTIC: FlowAppendedFields = 0
// STATISTIC: AccessesUnknown <= 6
// `declare x: T` says what a field holds and makes nothing; the constructor's store makes the property. Such a field is a field like any other: it lies in the object, a read of it is a load,
// and `this.stack.pop()` is the built-in. The class implements an interface, and most of its fields are declared by no other type of the program. The build counts the accesses of which it knows nothing.
interface Op {
  readonly tag: number;
}
interface Running {
  readonly id: number;
  take(tag: number): Op | undefined;
}
class Fiber implements Running {
  constructor(interruptible: boolean = true) {
    this.reset();
    this.id = ++Fiber.made;
    this.interruptibleHere = interruptible;
    this.stackOfOps = [];
    this.exitOfFiber = undefined;
  }
  static made = 0;
  declare readonly id: number;
  declare interruptibleHere: boolean;
  declare readonly stackOfOps: Array<Op>;
  declare exitOfFiber: string | undefined;
  declare setByReset: number;
  declare storedLater: number;
  declare neverStored: number;
  reset(): void {
    this.setByReset = 1;
  }
  later(): void {
    this.storedLater = 2;
  }
  take(tag: number): Op | undefined {
    while (true) {
      const op = this.stackOfOps.pop();
      if (!op) return undefined;
      if (op.tag === tag && this.interruptibleHere) return op;
    }
  }
}
class Narrowed extends Fiber {
  declare exitOfFiber: "done" | undefined;
  declare ownOfNarrowed: number;
  constructor() {
    super(false);
    this.ownOfNarrowed = 3;
    this.exitOfFiber = "done";
  }
}
const fiber = new Fiber();
console.log(JSON.stringify(Object.keys(fiber)), "neverStored" in fiber, "storedLater" in fiber, fiber.neverStored, fiber.storedLater);
fiber.later();
console.log(JSON.stringify(Object.keys(fiber)), JSON.stringify(fiber), Object.getOwnPropertyDescriptor(fiber, "stackOfOps")!.writable);
const narrowed = new Narrowed();
console.log(JSON.stringify(Object.keys(narrowed)), JSON.stringify(narrowed), narrowed.take(1));
delete (fiber as { exitOfFiber?: string }).exitOfFiber;
console.log(JSON.stringify(Object.keys(fiber)), fiber.exitOfFiber);
fiber.exitOfFiber = "again";
console.log(JSON.stringify(Object.keys(fiber)), fiber.exitOfFiber);
const all: Array<Running> = [fiber, narrowed];
console.log(all.map(running => running.id + ":" + running.take(0)).join());
let sum = 0;
for (let i = 0; i < 20000; i++) {
  fiber.stackOfOps.push({ tag: i & 3 }, { tag: 4 });
  sum += fiber.take(i & 3)!.tag + fiber.stackOfOps.length + fiber.id;
}
console.log(sum, fiber.take(9));
