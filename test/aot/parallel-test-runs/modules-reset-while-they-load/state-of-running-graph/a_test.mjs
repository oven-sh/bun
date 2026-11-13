import { test, vi, jest } from "bun:test";
import "./resetter.js";
import { add, items } from "./store.js";
import { seen } from "./user.js";
import "./late.js";
test("asks again", async () => {
  const said = [];
  said.push(add("test"), seen());
  { const m = await import("./store.js"); said.push(m.items.length, m.add === add); const u = await import("./user.js"); said.push(u.seen(), m.items.length, items.length); }
  { const m = await import("./late.js"); said.push("late", m.run, m.sees || "-"); }
  console.log(said.join(" "), JSON.stringify(globalThis.runs));
});
