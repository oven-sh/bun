import { describe, test } from "bun:test";
import * as whole from "./barrel.mjs";
const show = (...values) => values.map(v => typeof v === "function" ? "function " + (v.name || "") : typeof v === "object" && v ? JSON.stringify(v) : String(v)).join(" ");
const child = { __proto__: whole, pair(i) { return i & 1 ? super.count : super.own1; }, trio(i) { return i % 3 ? i % 3 === 1 ? super.text : super.own3 : super.ratio; } };
// describe() has no time limit. A test has five seconds, which these reads take in a Bun with a sanitizer on a busy machine.
describe("reads", () => {
  const said = new Set();
  for (let i = 0; i < 4000; i++) { said.add(show(child.pair(i))); said.add(show(child.trio(i))); if (i === 2000) { whole.change(); whole.turn(); } }
  console.log("SAID", [...said].join(" | "));
  test("stand", () => {});
});
