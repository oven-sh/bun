import { test } from "bun:test";
import { isWordCharacter, whichLoad } from "./library.js";
test("the next test file reads in a loop", () => {
  let words = 0;
  for (let i = 0; i < 5000; i++) if (isWordCharacter(32 + (i & 63))) words++;
  console.log("next", words, whichLoad());
});
