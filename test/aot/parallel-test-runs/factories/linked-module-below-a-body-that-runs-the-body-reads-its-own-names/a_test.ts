// The body of tax.ts reads its own names while it runs under the mock that was laid over them.
import { test } from "bun:test";
import { read } from "./ring";

test("what the ring reads", () => {
  console.log("ring reads", read());
});
