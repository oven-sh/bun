import { test, vi, jest } from "bun:test";
import "./resetter.js";
import { asked } from "./late.js";
globalThis.asked = asked;
test("asks again", async () => {
  const said = [];
  { const m = await import("./late.js"); said.push(m.asked); }
  { const m = await import("./late.js"); said.push("late", m.run, m.sees || "-"); }
  { const m = await import("./counter.js"); said.push("counter", m.run, m.sees || "-"); }
  console.log(said.join(" "), JSON.stringify(globalThis.runs));
});
