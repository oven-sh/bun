import { test } from "bun:test";
import * as all from "./u.mjs";
const key = ["wo", "rd"].join("");
test("t", async () => {
  const loaded = await import("./u.mjs");
  console.log("SAID", all[key], key in all, Object.keys(all).join(), loaded[key]);
});
