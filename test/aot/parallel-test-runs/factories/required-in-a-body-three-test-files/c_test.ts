import { mid } from "./mid";
import { test } from "bun:test";
test("c", async () => {
  console.log("c", mid, (await import("./tax")).rate);
});
