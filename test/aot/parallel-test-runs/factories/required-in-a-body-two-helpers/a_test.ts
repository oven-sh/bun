import { mid } from "./mid";
import { test } from "bun:test";
test("a", async () => {
  console.log("a", mid, (await import("./tax")).rate, (await import("./fee")).fee);
});
