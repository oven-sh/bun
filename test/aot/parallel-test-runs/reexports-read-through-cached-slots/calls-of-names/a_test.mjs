import { test } from "bun:test";
import * as whole from "./barrel.mjs";
const show = (...values) => values.map(v => typeof v === "function" ? "function " + (v.name || "") : typeof v === "object" && v ? JSON.stringify(v) : String(v)).join(" ");
test("reads", () => {
  let sum = 0;
  for (let i = 0; i < 4000; i++) sum += whole.twice(i) + whole.add(1) + whole.add.call(null, 1) + new whole.Box(i).value + whole["twice"](1) + (whole?.twice?.(2) ?? 0);
  console.log("SAID", sum, whole.total);
});
