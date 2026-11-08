import { test } from "bun:test";
import * as roads from "./roads";

import { fixed, words } from "./app";
test("the first file replaces and leaves it so", () => {
  console.log("first, as built:", words(roads.named(" ", "a b ")), fixed(2.25));
  roads.put(roads.aboveTexts, roads.named("index", "Of"), () => 41);
  roads.put(roads.aboveNumbers, roads.named("to", "Fixed"), () => "fixed by the first file");
  console.log("first, replaced:", words(roads.named(" ", "a b ")), fixed(2.25));
});
