import { test } from "bun:test";
import * as roads from "./roads";

import { marks, sum } from "./app";
test("a written text finds what the test has laid", () => {
  console.log("as built:", marks(), sum(3));
  for (const [above, name] of [[roads.aboveTexts, roads.named("toUpper", "Case")], [roads.aboveTexts, roads.named("rep", "eat")], [roads.aboveTexts, roads.named("index", "Of")], [roads.aboveNumbers, roads.named("to", "Fixed")], [roads.aboveBooleans, roads.named("to", "String")], [roads.aboveBigIntegers, roads.named("to", "String")], [roads.aboveTexts, roads.named("charCode", "At")]] as const) {
    const original = roads.put(above, name, () => 1);
    console.log(name + ":", marks(), sum(3));
    roads.put(above, name, original);
  }
  console.log("put back:", marks(), sum(3));
});
