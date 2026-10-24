// Held from creation: Array.from and Array.of construct whatever they are called on, with nothing or with a length, then define the elements and store `length` through the class's setter.
let total = 0;

class Bag {
  items = 0;
  [index: number]: unknown;
  constructor(name: string) {
    total += typeof name === "string" ? 1 : typeof name === "number" ? 100 : name === undefined ? 10000 : 0;
  }
  set length(value: string) {
    total += typeof value === "string" ? 1000000 : typeof value === "number" ? 100000000 + value : 0;
  }
}

const own = new Bag("mine");
own.length = "long";
const fromIterable = (Array.from as any).call(Bag, new Set(["a", "b"])) as Bag;
const fromArrayLike = (Array.from as any).call(Bag, { length: 3, 0: "x" }) as Bag;
const of = (Array.of as any).call(Bag, 1, 2, 3, 4) as Bag;
console.log(total, fromIterable instanceof Bag, fromIterable[1], fromArrayLike[0], fromArrayLike[2], of[3], of.items);
