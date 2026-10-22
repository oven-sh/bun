function describeError(run: () => unknown) {
  try {
    console.log("no error", run());
  } catch (error) {
    console.log((error as Error).name, (error as Error).message);
  }
}

function describeKeys(object: object) {
  return Reflect.ownKeys(object).map(String).join(",");
}

const path = require("node:path");
console.log(path.join("a", "..", "b"), path.basename("/x/y.ts", ".ts"), require("node:path") === path);

const fromLength = (length: unknown) => Array.from({ length } as any);
console.log(fromLength(-1).length, fromLength(0).length, fromLength(3).length, fromLength(2.7).length, fromLength(NaN).length, fromLength("2").length);
describeError(() => fromLength(2 ** 53).length);
let lengthReads = 0;
console.log(
  fromLength({
    valueOf() {
      lengthReads++;
      return 2;
    },
  }).length,
  lengthReads,
);
describeError(() =>
  fromLength({
    valueOf() {
      throw new Error("length failed");
    },
  }),
);

console.log(Array.from({ length: 3, 0: "a", 2: "c" } as any));
console.log(Array.from({ length: 40 }, (_, index) => index * 2).reduce((sum, item) => sum + item, 0));
console.log(Array.from([1, , 3]), Array.from("abc"), Array.from(new Set([1, 1, 2])));

for (let round = 0; round < 3; round++) {
  const entries = Object.fromEntries([
    ["0", 1],
    ["a", 2],
    [Symbol.iterator, 3],
  ]);
  console.log(describeKeys(entries), entries["0"], entries.a);
}
console.log(describeKeys(Object.fromEntries([[1.5, "x"], [-1, "y"], [4294967295, "z"], [0, "w"]])));
console.log(Object.fromEntries([["a", 1], ["a", 2]]).a);
const protoEntry = Object.fromEntries([["__proto__", 1]]);
console.log(describeKeys(protoEntry), Object.getPrototypeOf(protoEntry) === Object.prototype);

class Numbers extends Array<number> {}
const numbers = Numbers.from([1, 2, 3]);
console.log(numbers instanceof Numbers, numbers.length, numbers[2]);

function* countTo(last: number) {
  try {
    for (let item = 1; item <= last; item++) yield item;
  } finally {
    console.log("closed", last);
  }
}
for (const item of countTo(3)) {
  if (item === 2) break;
  console.log(item);
}
console.log(Array.from(countTo(2)));
const generator = countTo(1);
console.log(generator.next(), generator.next(), generator.next());

function* entriesWithThrowingKey() {
  try {
    const key: any = {
      toString() {
        throw new Error("key failed");
      },
    };
    yield [key, 1];
    console.log("not reached");
  } finally {
    console.log("entries closed");
  }
}
describeError(() => Object.fromEntries(entriesWithThrowingKey()));

const target = (Array.from as any).call(Object, [1, 2]);
console.log(Array.isArray(target), describeKeys(target), target[1], target.length);
