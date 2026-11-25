import { test } from "bun:test";
import asks from "./asks.cjs";
test("a", () => {
  globalThis.later = asks.later;
  const held = require("./part.cjs");
  console.log("a", asks.later().count(), held.count(), asks.later() === held);
});
