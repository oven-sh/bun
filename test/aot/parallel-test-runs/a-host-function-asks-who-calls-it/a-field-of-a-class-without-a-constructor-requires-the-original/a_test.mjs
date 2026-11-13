import { test } from "bun:test";
import { x } from "./dep.mjs";
import { Originals } from "./lib/helper.mjs";
test("the path is looked up from the folder of the class", () => {
  console.log("SAID", x, new Originals().x);
});
