import { test, expect } from "bun:test";

function mark(place: any) {
  place.shut = function () {
    return "from above";
  };
}

interface Gate {
  count: number;
  parts: number;
  shut(): string;
}
function Gate(this: Gate, v: number) {
  this.count = v;
  this.parts = v;
}
Gate.prototype.shut = function () {
  return "own";
};
function take(gate: Gate) {
  return gate.count + gate.parts;
}
function atEnd(this: Gate) {
  const said = this.shut();
  return said + take(this);
}
function put(holder: any, key: string, value: unknown) {
  holder[key] = value;
}
function drop(holder: any, key: string) {
  delete holder[key];
}
(globalThis as any).kept = { handler: atEnd, make: Gate, put, drop, marks: [Object.prototype, mark] };

test("the method on the prototype object hides what a test lays above it, until it is deleted or replaced", () => {
  const kept = (globalThis as any).kept;
  expect(kept.handler.call(new kept.make(1))).toBe("own2");
  kept.marks[1](kept.marks[0]);
  expect(kept.handler.call(new kept.make(1))).toBe("own2");
  kept.drop(kept.make.prototype, "shut");
  expect(kept.handler.call(new kept.make(1))).toBe("from above2");
  kept.put(kept.make.prototype, "shut", function () {
    return "again";
  });
  expect(kept.handler.call(new kept.make(1))).toBe("again2");
  const own = new kept.make(2);
  kept.put(own, "shut", function () {
    return "of its own";
  });
  expect(kept.handler.call(own)).toBe("of its own4");
  kept.drop(Object.prototype, "shut");
});
