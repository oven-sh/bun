import { spyOn, test } from "bun:test";
import { performance as clock } from "node:perf_hooks";
import { reading } from "./app.js";

// No file names the object that the spy is laid on: it comes out of a module of Bun. Nothing else in the run writes on a built-in, and nobody fakes a timer.
test("a spy on an object that a module of Bun hands out", () => {
  console.log("as made:", typeof reading(), clock === performance);
  const now = spyOn(clock, "now").mockImplementation(() => 7);
  console.log("spied on:", reading(), performance.now(), now.mock.calls.length);
  now.mockRestore();
  console.log("restored:", typeof reading(), reading() === 7);
});
