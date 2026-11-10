import { expect, test } from "vitest";
import { own, rule } from "./helper.js";
test("expect", () => {
  console.log(own() === expect, rule());
});
