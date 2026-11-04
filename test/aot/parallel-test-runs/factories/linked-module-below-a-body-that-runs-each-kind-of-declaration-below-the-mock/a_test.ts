// The mock is laid over the names of tax.ts, which is linked and has yet to run. Its body runs at its turn and fills what a body fills: a function declaration was filled when the module was linked.
import { test } from "bun:test";
import { read } from "./ring";

test("what the ring reads", () => {
  console.log("ring reads", read());
});
