import { test } from "bun:test";
import * as whole from "./barrel.mjs";
const show = (...values) => values.map(v => typeof v === "function" ? "function " + (v.name || "") : typeof v === "object" && v ? JSON.stringify(v) : String(v)).join(" ");
test("reads", () => {
  const keys = ["count", "text", "record", "ratio", "flag", "own1", "own3"];
  const said = [];
  for (let i = 0; i < 4000; i++) {
    const byKey = keys.map(key => whole[key]);
    if (i % 1000 === 0) { said.push(show(...byKey, whole.count, whole.text, whole.record, whole.ratio, whole.flag, whole.own1)); whole.change(); whole.turn(); }
    else { void whole.count; void whole.text; void whole.record; void whole.ratio; void whole.flag; void whole.own1; }
  }
  console.log("SAID", said.join(" | "));
});
