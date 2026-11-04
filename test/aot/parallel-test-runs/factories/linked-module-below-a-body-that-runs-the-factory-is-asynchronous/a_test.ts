// The factory is asynchronous: it settles behind the graph.
import { test } from "bun:test";
import { read } from "./ring";

test("what the ring reads", () => {
  console.log("ring reads", read());
});
