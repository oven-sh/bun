import { test } from "bun:test";
import * as roads from "./roads";

import { codes } from "./app";
test("charCodeAt is replaced while a loop runs", () => {
  const name = roads.named("char", "Code", "At");
  console.log("as built:", codes(roads.named("a", "bcd"), -1, () => {}));
  let original: unknown;
  console.log("from the third turn on:", codes(roads.named("a", "bcd"), 2, () => { original = roads.put(roads.aboveTexts, name, () => 7); }));
  console.log("replaced:", codes(roads.named("a", "bcd"), -1, () => {}));
  console.log("put back at the second turn:", codes(roads.named("a", "bcd"), 1, () => { roads.put(roads.aboveTexts, name, original); }));
  console.log("put back:", codes(roads.named("a", "bcd"), -1, () => {}));
});
