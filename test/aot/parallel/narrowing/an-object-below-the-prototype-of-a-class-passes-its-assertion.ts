// an object made by Object.create(Leaf.prototype) is an instance of Leaf that the constructor has never seen: it passes `instanceof`, comes through the join behind the arm that throws, and has none of the fields
class Leaf {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
}

function fail(): never {
  throw new RangeError("no leaf");
}

function valueOf(x: unknown): unknown {
  if (!(x instanceof Leaf)) fail();
  return x.value;
}

function deed(): unknown {
  return Object.create(Leaf.prototype);
}

function tell(x: unknown): string {
  try {
    return String(valueOf(x));
  } catch (error) {
    return (error as Error).name + ": " + (error as Error).message;
  }
}

console.log(tell(new Leaf(1)), tell({ value: 2 }), tell(null));
let seen = "";
for (let i = 0; i < 300; i++) seen = tell(new Leaf(i));
console.log(seen);
console.log(tell(deed()));
for (let i = 0; i < 3; i++) console.log(tell(i === 1 ? deed() : new Leaf(i)));
