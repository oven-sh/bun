import { test, vi, jest } from "bun:test";
import "./resetter.js";
import "./late.cjs";
import "./late.js";
test("asks again", async () => {
  const said = [];
  { const m = await import("./late.cjs"); said.push("cjs", m.default.run); }
  { const m = await import("./late.js"); said.push("late", m.run, m.sees || "-"); }
  { const m = await import("./counter.js"); said.push("counter", m.run, m.sees || "-"); }
  console.log(said.join(" "), JSON.stringify(globalThis.runs));
});
