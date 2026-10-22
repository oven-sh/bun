// Behind one parameter of the type { size(): number } stand classes that are no relatives, literals and fields that hold functions. One after the other is changed: a method on a prototype, a method of a literal, a field, a getter; each change is seen by the next call and by nothing else. One number is printed.
class Box {
  constructor(public width: number) {}
  size(): number {
    return this.width;
  }
}
class Bag {
  items = [1, 2, 3];
  size(): number {
    return this.items.length;
  }
}
class Pile {
  size(): number {
    return 42;
  }
}
class Held {
  amount = 5;
  size = (): number => this.amount;
}

function measureAll(list: { size(): number }[]): number {
  let sum = 0;
  for (const x of list) sum = sum * 3 + x.size();
  return sum;
}

function attempt(run: () => number): number {
  try {
    return run();
  } catch (error) {
    return error instanceof TypeError ? -1 : -2;
  }
}

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

const withMethod = {
  depth: 9,
  size() {
    return this.depth;
  },
};
const box = new Box(7);
const held = new Held();
const list = [box, new Bag(), new Pile(), held, withMethod, new Box(8)];

note(measureAll(list));
Bag.prototype.size = () => 100;
note(measureAll(list));
withMethod.size = () => 200;
note(measureAll(list));
held.size = () => 300;
note(measureAll(list));
box.size = () => 400;
note(measureAll(list));
Object.defineProperty(Pile.prototype, "size", { get: () => () => 500, configurable: true });
note(measureAll(list));
Reflect.deleteProperty(held, "size");
note(attempt(() => measureAll(list)));
Reflect.deleteProperty(box, "size");
Object.setPrototypeOf(held, Box.prototype);
note(Number.isNaN(measureAll(list)) ? -3 : 0);
Object.assign(held, { width: 6 });
note(measureAll(list));
console.log(checksum);

export {};
