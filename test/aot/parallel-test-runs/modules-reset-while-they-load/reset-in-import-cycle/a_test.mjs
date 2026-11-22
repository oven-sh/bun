import { test, vi, jest } from "bun:test";
import "./a.js";
test("asks again", async () => {
  const said = [];
  { const m = await import("./a.js"); said.push("a", m.run, m.sees || "-"); }
  { const m = await import("./b.js"); said.push("b", m.run, m.sees || "-"); }
  { const m = await import("./resetter.js"); said.push("resetter", m.run, m.sees || "-"); }
  { const m = await import("./counter.js"); said.push("counter", m.run, m.sees || "-"); }
  console.log(said.join(" "), JSON.stringify(globalThis.runs));
});
