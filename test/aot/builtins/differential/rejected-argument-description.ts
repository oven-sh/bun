// A native function that rejects an argument describes it in the message. Plain Bun does what Node does, which can run the program's code: a getter, a proxy trap, a custom inspect function. A compiled program runs none of it and names an object that is neither plain nor an array by its class, so it has an .expected.txt. test/js/node/errors/invalid-arg-type-received.test.ts has what plain Bun prints.
import { openSync } from "node:fs";
let calls = 0;
function told(run: () => unknown): string {
  calls = 0;
  try {
    run();
  } catch (error: any) {
    return `${error.code}: ${error.message} | ${calls > 0 ? "ran code of the program" : "ran nothing"}`;
  }
  return "no error";
}
const custom = Symbol.for("nodejs.util.inspect.custom");
class Point {
  x = 1;
  y = 2;
}
class WithInspect {
  x = 1;
  [custom]() {
    calls++;
    return "CUSTOM";
  }
}
const countingHandler = {
  get(target: object, key: PropertyKey, receiver: unknown) {
    calls++;
    return Reflect.get(target, key, receiver);
  },
};
const wrongTypes: any[] = [
  new Point(),
  new (class {})(),
  {},
  [],
  Object.create(null),
  {
    get constructor() {
      calls++;
      return Point;
    },
  },
  Object.create({
    get constructor() {
      calls++;
      return Point;
    },
  }),
  new (Object.defineProperty(class {}, "name", {
    get() {
      calls++;
      return "Computed";
    },
  }))(),
  new Proxy([], {}),
  new Proxy(new Point(), countingHandler),
  {
    __proto__: null,
    [custom]() {
      calls++;
      return "CUSTOM";
    },
  },
];
for (const value of wrongTypes) console.log(told(() => Buffer.compare(value, Buffer.alloc(1))));
const wrongValues: any[] = [
  {},
  [],
  { a: 1 },
  [1, 2],
  new Point(),
  { point: new Point(), list: [1, [2]] },
  {
    get a() {
      calls++;
      return 1;
    },
    b: 2,
  },
  {
    [custom]() {
      calls++;
      return "CUSTOM";
    },
  },
  new WithInspect(),
  new Proxy({ a: 1 }, countingHandler),
  new Date(0),
  /x/g,
  new Uint8Array([1, 2]),
  { when: new Date(0), list: [/x/g] },
];
for (const value of wrongValues) console.log(told(() => openSync("file", value)));
