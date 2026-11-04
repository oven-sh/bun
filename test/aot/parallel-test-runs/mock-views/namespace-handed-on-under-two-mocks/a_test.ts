import { mock, test } from "bun:test";
import * as inner from "./inner";
import * as one from "./one";
import * as two from "./two";

// Both modules have run, so each mock is laid over its module. Neither `space` nor `again` has a variable to patch: the object has one place, in the module that is handed on.
test("what a mock gives for a namespace that its module hands on is read in place of the object", async () => {
  console.log("loaded:", one.space.v, two.again.v, inner.v);
  await mock.module("./one", () => ({ space: { v: "of one" }, name: "mock one" }));
  console.log("one is mocked:", one.space.v, two.again.v, one.name, two.name, inner.v);
  await mock.module("./two", () => ({ again: { v: "of two" }, name: "mock two" }));
  console.log("both are mocked:", one.space.v, two.again.v, one.name, two.name, inner.v);
  await mock.module("./two", () => ({ again: { v: "of two again" }, name: "mock two again" }));
  console.log("two is mocked again:", one.space.v, two.again.v, one.name, two.name, inner.v);
});
