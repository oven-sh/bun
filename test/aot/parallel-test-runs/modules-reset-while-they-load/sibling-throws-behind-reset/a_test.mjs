import { test, vi, jest } from "bun:test";
test("asks again", async () => {
  const said = [];
  try { await import("./outer.js"); } catch (error) { said.push(error.message); }
  { const m = await import("./late.js"); said.push("late", m.run, m.sees || "-"); }
  { const m = await import("./counter.js"); said.push("counter", m.run, m.sees || "-"); }
  { const m = await import("./resetter.js"); said.push("resetter", m.run, m.sees || "-"); }
  { const m = await import("./outer.js"); said.push("outer", m.run, m.sees || "-"); }
  console.log(said.join(" "), JSON.stringify(globalThis.runs));
});
