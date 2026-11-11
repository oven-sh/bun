import { test, mock, vi, jest } from "bun:test";

test("made up", async () => {
  const said = [];
  const { far } = await import("./far.mjs"); said.push(far);
  console.log("SAID " + said.join(","));
});
