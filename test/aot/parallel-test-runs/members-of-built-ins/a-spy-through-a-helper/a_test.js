import { test } from "bun:test";
import { distance, keysOf } from "./app.js";
import { watch } from "./watch.js";

// The file that calls spyOn() knows neither the object nor the name, and the file that knows them names no spy.
test("a spy that a helper lays records the calls of the code under test", () => {
  console.log("as made:", distance(3, 4), keysOf({ a: 1, b: 2 }));
  const hypot = watch(Math, "hypot").mockReturnValue(-1);
  const keys = watch(Object, "keys");
  console.log("spied on:", distance(3, 4), keysOf({ a: 1, b: 2 }));
  console.log("calls:", hypot.mock.calls.length, JSON.stringify(hypot.mock.calls[0]), keys.mock.calls.length);
  hypot.mockRestore();
  keys.mockRestore();
  console.log("restored:", distance(3, 4), keysOf({ a: 1, b: 2 }));
});
