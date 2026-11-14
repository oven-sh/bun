import { test, beforeAll } from "bun:test";
import { mid } from "./mid";
test("a", async () => {
  mid();
  console.log("SAID", "a", (await import("./tax")).rate);
});
