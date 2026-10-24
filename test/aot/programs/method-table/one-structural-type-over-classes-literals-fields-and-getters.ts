// A parameter of the type { size(): number } gets objects of three classes that are no relatives, a literal with a method, a literal and a class that hold a function in a field, a class whose getter answers a function, and a function object with such a member.
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
class Lazy {
  asked = 0;
  get size(): () => number {
    this.asked++;
    return () => 60 + this.asked;
  }
}

function measure(x: { size(): number }): number {
  return x.size();
}

function measureAll(list: { size(): number }[]): number {
  let sum = 0;
  for (const x of list) sum = sum * 3 + x.size();
  return sum;
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
const withArrow = { size: () => 10 };
const callable = Object.assign(() => 0, { size: () => 11 });
const list = [new Box(7), new Bag(), new Pile(), new Held(), new Lazy(), withMethod, withArrow, callable];

for (const x of list) note("one", measure(x));
note("all", measureAll(list));
let sum = 0;
for (let round = 0; round < 100; round++) sum = (sum + measureAll(list)) % 1000003;
note("a hundred rounds", sum);

export {};
