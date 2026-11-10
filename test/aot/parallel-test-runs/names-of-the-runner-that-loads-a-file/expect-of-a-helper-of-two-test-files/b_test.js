import { expect, test } from "bun:test";
import { own, rule } from "./shared.js";
test("below bun:test", () => {
  console.log(own() === expect, rule());
});
