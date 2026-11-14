import { test } from "bun:test";
import { atBody, via } from "./mid.js";
test("t", async () => {
  console.log("SAID in the test", atBody, via(), (await import("mocked-commonjs-package")).who());
});
