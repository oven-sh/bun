import { test } from "bun:test";
import * as roads from "./roads";

import { bigInteger, boolean, number, symbol } from "./app";
const all = () => [number(255.5), boolean(true), symbol(Symbol("s")), bigInteger(5n)].join(" ; ");
test("each kind of primitive has its own object above it", () => {
  console.log("as built:", all());
  for (const [above, name] of [[roads.aboveNumbers, roads.named("to", "Fixed")], [roads.aboveNumbers, roads.named("to", "String")], [roads.aboveBooleans, roads.named("to", "String")], [roads.aboveSymbols, roads.named("to", "String")], [roads.aboveBigIntegers, roads.named("to", "String")], [roads.aboveNumbers, roads.named("value", "Of")]] as const) {
    const original = roads.put(above, name, () => "mine");
    console.log(name + ":", all());
    roads.put(above, name, original);
    console.log("put back:", all());
  }
});
