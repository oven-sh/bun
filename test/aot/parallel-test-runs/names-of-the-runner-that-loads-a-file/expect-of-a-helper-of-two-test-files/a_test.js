import { expect, test } from "vitest";
import { own, rule } from "./shared.js";
test("below vitest", () => {
  console.log(own() === expect, rule());
});
