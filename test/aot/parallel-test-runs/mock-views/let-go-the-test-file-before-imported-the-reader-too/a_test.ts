// a_test.ts and reader.ts are let go at the end of a_test.ts. b_test.ts brings reader.ts back; a_test.ts stays away, and what it has passed says nothing of the graph that runs now.
import { test, mock } from "bun:test";
import { read } from "./reader";
test("a", () => {
  mock.module("./dep", () => ({ value: () => "mock a" }));
  console.log("a", read());
});
