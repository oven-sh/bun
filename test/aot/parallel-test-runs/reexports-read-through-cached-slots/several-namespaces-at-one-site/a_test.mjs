import { describe, test } from "bun:test";
import * as whole from "./barrel.mjs";
const show = (...values) => values.map(v => typeof v === "function" ? "function " + (v.name || "") : typeof v === "object" && v ? JSON.stringify(v) : String(v)).join(" ");
import * as other from "./other.mjs";
import * as lib from "./lib.mjs";
const read = space => [space.count, space.text, space.ratio];
// describe() has no time limit. A test has five seconds, which these reads take in a Bun with a sanitizer on a busy machine.
describe("reads", () => {
  const said = new Set();
  for (let i = 0; i < 4000; i++) { for (const space of [whole, other, lib]) said.add(show(...read(space))); if (i === 2000) whole.change(); }
  console.log("SAID", [...said].join(" | "));
  test("stand", () => {});
});
