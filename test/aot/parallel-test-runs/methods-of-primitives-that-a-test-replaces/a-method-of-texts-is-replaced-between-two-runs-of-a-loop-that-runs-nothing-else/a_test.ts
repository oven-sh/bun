import { test } from "bun:test";
import * as roads from "./roads";

import { breaks, lines } from "./app";
test("charCodeAt is replaced between two scans", () => {
  const name = roads.named("charCode", "At"), text = roads.named("a\nb\r", "\nc\rd\n");
  console.log("as built:", breaks(text, 0), breaks(text, 2), lines(text));
  const original = roads.put(roads.aboveTexts, name, () => 10);
  console.log("every place is a break:", breaks(text, 0), breaks(text, 2), lines(text));
  roads.put(roads.aboveTexts, name, original);
  console.log("put back:", breaks(text, 0), breaks(text, 2), lines(text));
});
