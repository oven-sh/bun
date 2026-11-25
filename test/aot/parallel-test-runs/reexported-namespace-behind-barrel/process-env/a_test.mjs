import { test } from "bun:test";
import { inner } from "./top.mjs";
test("t", async () => {
  console.log("SAID", typeof inner.env);
  await 0;
});
