import { test } from "bun:test";
import * as all from "./u.mjs";
test("t", () => {
  console.log("SAID", all.word);
});
