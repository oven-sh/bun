// for-in walks objects that have from no index keys to a thousand, and names of their own that their prototypes have too.
type Bag = Record<string, unknown>;

function walk(object: object): string {
  let indexes = 0;
  const names: string[] = [];
  for (const key in object) {
    if (String(+key) === key) indexes++;
    else names.push(key);
  }
  return indexes + ":" + names.join(",");
}

function fill<T extends object>(object: T, count: number): T {
  for (let i = 0; i < count; i++) (object as Bag)[i] = i;
  return object;
}

class Point {
  x = 1;
  y = 2;
}
Object.assign(Point.prototype, { x: 0, z: 0 });

function Pair(this: Bag) {
  this.first = 1;
  this.second = 2;
}
Pair.prototype.second = 0;
Pair.prototype.third = 0;

const makers: Record<string, (count: number) => object> = {
  "a name is stored behind the indexes"(count) {
    const object: Bag = fill(Object.create({ b: 7 }), count);
    object.b = null;
    return object;
  },
  "a name is stored ahead of the indexes"(count) {
    const object: Bag = Object.create({ b: 7 });
    object.b = null;
    return fill(object, count);
  },
  "a literal"(count) {
    return fill({ __proto__: { b: 7, c: 1 }, a: 0, b: 1 }, count);
  },
  "an instance of a class"(count) {
    return fill(new Point(), count);
  },
  "an instance of a function"(count) {
    return fill(new (Pair as unknown as new () => Bag)(), count);
  },
  "a name that is not enumerable hides one that is"(count) {
    return Object.defineProperty(fill(Object.create({ b: 7, c: 1 }), count), "b", { value: 1, enumerable: false });
  },
  "a name that is enumerable hides one that is not"(count) {
    const object: Bag = fill(Object.create(Object.defineProperty({ c: 1 }, "b", { value: 7, writable: true })), count);
    object.b = 1;
    return object;
  },
  "three objects with indexes"(count) {
    const top: Bag = fill({ b: 1, d: 2, e: 3 }, count + 2);
    const middle: Bag = fill(Object.create(top), count + 1);
    middle.d = 1;
    const bottom: Bag = fill(Object.create(middle), count);
    bottom.b = 1;
    return bottom;
  },
  "many names and indexes"(count) {
    const object: Bag = fill(Object.create({ k0: 0, k7: 0, k30: 0, other: 0 }), count);
    for (let i = 0; i < count; i++) object["k" + i] = i;
    return object;
  },
  "a name is removed and stored again"(count) {
    const object: Bag = fill({ __proto__: { a: 0, b: 7 }, a: 1, b: 1 }, count);
    delete object.a;
    object.a = 2;
    return object;
  },
  "a list"(count) {
    const list = fill([] as unknown[], count);
    Object.setPrototypeOf(list, { b: 7, c: 1 });
    (list as unknown as Bag).b = 1;
    return list;
  },
  "a function"(count) {
    const callee = fill(function () {}, count);
    Object.setPrototypeOf(callee, { b: 7, c: 1 });
    (callee as unknown as Bag).b = 1;
    return callee;
  },
};

for (const [label, make] of Object.entries(makers)) {
  const walks: string[] = [];
  for (const count of [0, 1, 19, 20, 21, 22, 64, 1000]) {
    const object = make(count);
    const walked = walk(object);
    walks.push(
      walked.length > 40 ? walked.length + " characters, " + new Set(walked.split(",")).size + " names" : walked,
    );
    if (walk(object) !== walked) walks.push("and otherwise the second time");
  }
  console.log(label + " | " + walks.join(" | "));
}
