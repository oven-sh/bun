import { expect } from "bun:test";
import { classesWithInspectMethod } from "../../../src/codegen/builtins/host/classes-with-inspect-method";
import { test } from "../supported";

test("the table lists every global class that has a method under the inspect symbol", () => {
  const custom = Symbol.for("nodejs.util.inspect.custom");
  const found = Object.getOwnPropertyNames(globalThis).filter(name => {
    const value = (globalThis as Record<string, unknown>)[name];
    return typeof value === "function" && !!value.prototype && Object.hasOwn(value.prototype, custom);
  });
  // The formatter calls the method of Buffer without loading anything.
  expect(found.sort()).toEqual([...classesWithInspectMethod, "Buffer"].sort());
});
