// Behind the graph a call imports the module over which the mock was laid while it was linked.
import { test } from "bun:test";
import { read } from "./ring";

test("what the ring reads, and what a call gets", async () => {
  console.log("ring reads", read());
  const tax = await import("./tax");
  console.log("a call gets", tax.rate, tax.above());
});
