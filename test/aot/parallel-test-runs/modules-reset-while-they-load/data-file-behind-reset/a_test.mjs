import { test, vi, jest } from "bun:test";
import "./resetter.js";
import json from "./late.json";
import "./late.js";
globalThis.first = json;
test("asks again", async () => {
  const said = [];
  { const m = await import("./late.json"); said.push("json", m.default === globalThis.first); }
  { const m = await import("./late.js"); said.push("late", m.run, m.sees || "-"); }
  console.log(said.join(" "), JSON.stringify(globalThis.runs));
});
