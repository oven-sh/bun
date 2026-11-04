// The mock that was laid over a linked module ends when its body has run.
import { test, vi } from "bun:test";
import { read } from "./ring";

test("what the ring reads", () => {
  console.log("ring reads", read());
  vi.doUnmock("./tax");
  console.log("behind the end", read());
});
