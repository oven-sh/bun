// Behind one parameter of the type { size(): number } stand classes that are no relatives, literals and fields that hold functions. One after the other is changed: a method on a prototype, a method of a literal, a field, a getter; each change is seen by the next call and by nothing else.
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

function note(label: string, value: number): void {
  console.log(label + ": " + value);
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

note("at first", measureAll(list));
Bag.prototype.size = () => 100;
note("a method on one prototype", measureAll(list));
withMethod.size = () => 200;
note("the method of the literal", measureAll(list));
held.size = () => 300;
note("the field", measureAll(list));
box.size = () => 400;
note("one of the two boxes", measureAll(list));
Object.defineProperty(Pile.prototype, "size", { get: () => () => 500, configurable: true });
note("a getter on a prototype", measureAll(list));
Reflect.deleteProperty(held, "size");
note("the field is deleted", attempt(() => measureAll(list)));
Reflect.deleteProperty(box, "size");
Object.setPrototypeOf(held, Box.prototype);
note("its object hangs under another class", Number.isNaN(measureAll(list)) ? -3 : 0);
Object.assign(held, { width: 6 });
note("and gets the field that the method reads", measureAll(list));

export {};
