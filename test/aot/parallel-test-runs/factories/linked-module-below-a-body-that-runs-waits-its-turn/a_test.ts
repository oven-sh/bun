// tax.ts is linked and has yet to run when helper.ts mocks it, and it imports ring.ts, whose evaluation is under way up the stack: its body does not run ahead of that import.
import { test } from "bun:test";
import { read } from "./ring";

test("what the ring reads", () => {
  console.log("ring reads", read());
});
