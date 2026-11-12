import { test } from "bun:test";
import * as roads from "./roads";

import { both, tail } from "./app";
test("slice is replaced and put back", () => {
  const name = roads.named("sl", "ice");
  console.log("as built:", tail(roads.named("a", "bc")), both(roads.named("a", "bc"), () => {}));
  let original: unknown;
  console.log("in the middle:", both(roads.named("a", "bc"), () => { original = roads.put(roads.aboveTexts, name, function (this: string) { return "mine:" + this; }); }));
  console.log("replaced:", tail(roads.named("a", "bc")), both(roads.named("a", "bc"), () => {}));
  console.log("put back in the middle:", both(roads.named("a", "bc"), () => { roads.put(roads.aboveTexts, name, original); }));
  console.log("put back:", tail(roads.named("a", "bc")), both(roads.named("a", "bc"), () => {}));
});
