import { describe, test } from "bun:test";
import * as whole from "./barrel.mjs";
const show = (...values) => values.map(v => typeof v === "function" ? "function " + (v.name || "") : typeof v === "object" && v ? JSON.stringify(v) : String(v)).join(" ");
// describe() has no time limit. A test has five seconds, which these reads take in a Bun with a sanitizer on a busy machine.
describe("reads", () => {
  const said = new Set();
  for (let i = 0; i < 4000; i++) {
    said.add(["count" in whole, "missing" in whole, Object.hasOwn(whole, "text"), Object.hasOwn(whole, "missing"), typeof whole.count, typeof whole.text, typeof whole.add, typeof whole.missing, whole.record?.name.length > 0].join());
    if (i === 2000) { whole.change(); whole.turn(); }
  }
  console.log("SAID", [...said].join(" | "));
  test("stand", () => {});
});
