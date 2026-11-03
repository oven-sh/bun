import { expect } from "bun:test";
import { EventEmitter } from "node:events";
import { bench, run } from "../runner.mjs";

class Point {
  constructor() {
    this.x = 1;
    this.y = 2;
  }
}

class Base {
  constructor() {
    this.id = 1;
  }
}
class Middle extends Base {}
class Derived extends Middle {}

function deepClass(prototypes) {
  let Class = Base;
  for (let i = 1; i < prototypes; i++) Class = class extends Class {};
  return new Class();
}

const user = () => ({
  id: 1,
  name: "n",
  email: "e",
  createdAt: 1,
  updatedAt: 2,
  role: "r",
  active: true,
  profile: 3,
});

// One row for each kind of value that toMatchObject() gets as the whole received or expected value.
const cases = {
  "two objects of one shape": [
    { a: 1, b: 2 },
    { a: 1, b: 2 },
  ],
  "3 properties, 1 expected": [{ a: 1, b: 2, c: 3 }, { a: 1 }],
  "8 properties, 1 expected": [user(), { id: 1 }],
  "class instance": [new Point(), { x: 1 }],
  "class instance, 3 prototypes": [new Derived(), { id: 1 }],
  "class instance, 12 prototypes": [deepClass(12), { id: 1 }],
  "EventEmitter": [new EventEmitter(), {}],
  "URL": [new URL("http://example.com/"), {}],
  "URL expected": [new URL("http://example.com/"), new URL("http://example.com/")],
  "array": [
    [1, 2, 3],
    [1, 2, 3],
  ],
  "nested object": [{ x: 1, y: { z: 2 } }, { y: { z: 2 } }],
  "expect.any(Object)": [{ a: 1, b: 2 }, expect.any(Object)],
  "expect.objectContaining()": [{ a: 1, b: 2 }, expect.objectContaining({ a: 1 })],
};

for (const [name, [received, expected]] of Object.entries(cases)) {
  bench(`toMatchObject: ${name}`, () => expect(received).toMatchObject(expected));
}

await run();
