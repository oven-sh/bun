import { test } from "vitest";
import { load } from "./helper.js";
test("mock", async () => {
  console.log((await load()).mode);
});
