import { test } from "bun:test";
import { look } from "./door.mjs";
test("b", () => {
  console.log("b", look(), "runs", process.env.PACK_RUNS);
});
