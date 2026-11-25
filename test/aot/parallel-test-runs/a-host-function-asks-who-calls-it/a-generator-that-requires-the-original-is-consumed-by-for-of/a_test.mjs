import { test } from "bun:test";
import { x } from "./dep.mjs";
import { originals } from "./lib/helper.mjs";
test("the path is looked up from the folder of the generator", () => {
  const seen = [];
  for (const original of originals()) seen.push(original);
  console.log("SAID", x, seen.join(" "));
});
