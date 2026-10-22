// Methods of three classes call one another in a ring without end: a RangeError that the program catches, twice, as under plain Bun. Then one of them is replaced by a method that answers, and the ring ends there.
// The objects pass through text that is compiled at run time, so nothing proves that the methods stay as they are.
class Link {
  next: Link;
  constructor() {
    this.next = this;
  }
  depth(count: number): number {
    return this.next.depth(count + 1) + 1;
  }
}
class Red extends Link {
  depth(count: number): number {
    return this.next.depth(count + 1) + 2;
  }
}
class Blue extends Link {
  depth(count: number): number {
    return this.next.depth(count + 1) + 3;
  }
}

const passThrough = new Function("value", "return value") as (value: Link[]) => Link[];
const ring: Link[] = passThrough([new Link(), new Red(), new Blue()]);
for (let index = 0; index < ring.length; index++) ring[index].next = ring[(index + 1) % ring.length];

function attempt(): string {
  try {
    return "returned " + ring[0].depth(0);
  } catch (error) {
    return error instanceof RangeError ? "RangeError" : "another error";
  }
}

console.log(attempt());
console.log(attempt());
Blue.prototype.depth = function (count: number): number {
  return count;
};
console.log(attempt());
