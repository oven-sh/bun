import { test } from "bun:test";
import { atBody, via } from "./importer.js";
test("t", async () => {
  console.log("SAID in the test", atBody, via(), (await import("./dep.js")).who());
});
