import { test } from "bun:test";
import { x } from "./user";
test("the next file loads the modules", async () => {
  await new Promise(resolve => setImmediate(resolve));
  console.log("SAID", x);
});
