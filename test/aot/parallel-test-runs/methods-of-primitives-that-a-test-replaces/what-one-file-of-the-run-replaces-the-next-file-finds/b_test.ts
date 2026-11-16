import { test } from "bun:test";
import * as roads from "./roads";

import { fixed, words } from "./app";
test("the second file calls the same functions", () => {
  console.log("second:", words(roads.named(" ", "a b ")), fixed(2.25));
  console.log("second, its own calls:", roads.named(" ", "a b ").indexOf("b"), (2.25).toFixed(1));
});
