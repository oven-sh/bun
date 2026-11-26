import { test } from "bun:test";
import { r } from "./root.mjs";
test("b", async () => {
  console.log(r);
});
