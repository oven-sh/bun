import { test } from "bun:test";
import { atCall, via } from "./root.js";
test("t", async () => {
  console.log("SAID in the test", atCall, via(), (await import("./dep.js?v")).who());
});
