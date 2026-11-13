import { test, vi, jest } from "bun:test";
import "./resetter.js";
import { run as barrelRun } from "./barrel.js";
void barrelRun;
test("asks again", async () => {
  const said = [];
  { const m = await import("./barrel.js"); said.push(m.run, m.inner.run, m.sees); }
  { const m = await import("./late.js"); said.push("late", m.run, m.sees || "-"); }
  console.log(said.join(" "), JSON.stringify(globalThis.runs));
});
