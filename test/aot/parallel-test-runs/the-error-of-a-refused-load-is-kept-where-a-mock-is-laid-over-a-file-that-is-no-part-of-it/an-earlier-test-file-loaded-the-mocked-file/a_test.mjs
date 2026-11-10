import { test } from "bun:test";
import { rung } from "./rung.mjs";
test("first", () => {
  console.log("SAID first", rung);
});
