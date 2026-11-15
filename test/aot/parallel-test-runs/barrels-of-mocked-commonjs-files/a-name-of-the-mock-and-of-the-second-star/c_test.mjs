import { test } from "bun:test";
import * as all from "./index.mjs";

test("a later file sees neither", () => {
  console.log("c", Object.keys(all).join(), "count" in all, all.count);
});
