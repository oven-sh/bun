import "./helper";
import { test } from "bun:test";

test("b", async () => {
  console.log("b", (await import("./rate")).rate, "|", (await import("./fee")).fee);
});
