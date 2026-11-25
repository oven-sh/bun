import { test } from "bun:test";
test("b", async () => {
  const dep = await import("made-up-pkg");
  console.log("| b " + dep.kind + " " + dep.extra);
});
