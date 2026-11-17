import { describe, test } from "bun:test";
import * as whole from "./barrel.mjs";
const show = (...values) => values.map(v => typeof v === "function" ? "function " + (v.name || "") : typeof v === "object" && v ? JSON.stringify(v) : String(v)).join(" ");
// describe() has no time limit. A test has five seconds, which these reads take in a Bun with a sanitizer on a busy machine.
describe("reads", () => {
  const child = Object.create(whole);
  const said = [];
  for (let i = 0; i < 4000; i++) {
    const { count, text, ratio, own1 } = whole;
    const { record, flag, own3 } = child;
    if (i % 1000 === 0) { said.push(show(count, text, ratio, own1, record, flag, own3, child.count, child.text)); whole.change(); whole.turn(); }
  }
  console.log("SAID", said.join(" | "), Object.keys({ ...whole }).length);
  test("stand", () => {});
});
