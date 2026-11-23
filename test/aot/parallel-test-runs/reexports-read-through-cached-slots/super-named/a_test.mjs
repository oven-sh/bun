import { test } from "bun:test";
import * as whole from "./barrel.mjs";
const show = (...values) => values.map(v => typeof v === "function" ? "function " + (v.name || "") : typeof v === "object" && v ? JSON.stringify(v) : String(v)).join(" ");
const child = {
  __proto__: whole,
  all() { return [super.count, super.text, super.record, super.ratio, super.flag, super.total, super.own1, super.own3, super.own5]; },
  call(i) { return super.twice(i) + super.add(1); },
  made(i) { return new super.Box(i).value; },
};
test("reads", () => {
  const said = [];
  let sum = 0;
  for (let i = 0; i < 4000; i++) {
    sum += child.call(i) + child.made(i);
    const all = child.all();
    if (i % 1000 === 0) { said.push(show(...all)); whole.change(); whole.turn(); }
  }
  console.log("SAID", sum, said.join(" | "), show(...child.all()));
});
