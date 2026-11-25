import { mid } from "./mid";
import { test } from "bun:test";
test("b", async () => {
  console.log("b", mid, (await import("./tax")).rate, (await import("./fee")).fee);
});
