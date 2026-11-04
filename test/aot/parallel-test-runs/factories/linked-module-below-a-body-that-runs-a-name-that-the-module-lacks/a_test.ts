// The mock gives a name that tax.ts does not export, and lacks one that it exports.
import { test } from "bun:test";
import { read } from "./ring";

test("what the ring reads", () => {
  console.log("ring reads", read());
});
