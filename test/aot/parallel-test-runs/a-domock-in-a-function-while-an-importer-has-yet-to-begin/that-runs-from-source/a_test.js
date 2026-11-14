import { test } from "bun:test";
import { read } from "./mocks.js";
import { atBody, via } from "./importer.js?v";
test("t", async () => {
  console.log("SAID in the test", read(), atBody, via(), (await import("./dep.js")).who());
});
