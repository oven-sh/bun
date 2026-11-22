import { test, mock, vi, jest } from "bun:test";

test("made up", async () => {
  const said = [];
  const { default: read } = await import("./reader.cjs"); said.push(read.a);
  console.log("SAID " + said.join(","));
});
