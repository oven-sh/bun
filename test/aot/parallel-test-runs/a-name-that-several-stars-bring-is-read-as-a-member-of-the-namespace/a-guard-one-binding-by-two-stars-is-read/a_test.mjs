import { test } from "bun:test";
import * as all from "./outer.mjs";
test("t", async () => {
  console.log("SAID", String(all.rate), all.own);
  await 0;
});
