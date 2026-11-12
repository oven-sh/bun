import { test } from "bun:test";
import * as whole from "./barrel.mjs";
const show = (...values) => values.map(v => typeof v === "function" ? "function " + (v.name || "") : typeof v === "object" && v ? JSON.stringify(v) : String(v)).join(" ");
const child = { __proto__: whole, all() { return [super.count, super.text, super.record, super.ratio, super.own1, whole.count, whole.record]; } };
test("reads", () => {
  const said = [];
  for (let i = 0; i < 4000; i++) { const all = child.all(); if (i % 500 === 0) { Bun.gc(true); said.push(show(...all)); whole.change(); whole.turn(); } }
  console.log("SAID", said.join(" | "));
});
