import { test } from "bun:test";
import { writeFileSync } from "node:fs";
test("b", async () => {
  console.log("SAID b", JSON.stringify((await import("./shared.txt")).default));
});
