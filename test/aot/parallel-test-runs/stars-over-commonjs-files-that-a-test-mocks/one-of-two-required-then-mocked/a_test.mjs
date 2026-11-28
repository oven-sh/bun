import { test, mock, vi, jest, spyOn } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const said = m => Object.keys(m).join() + " shared:" + (typeof m.shared === "function" ? m.shared() : String(m.shared)) + " added:" + String(m.added);
const show = async (label, get) => { try { console.log(label, said(await get())); } catch (e) { console.log(label, "threw", e.name); } };
test("t", async () => {
  require("./c.cjs");
  require("./d.cjs");
  mock.module("./d.cjs", () => ({ shared: "patched d" }));
  await show("cd.mjs", () => import("./cd.mjs"));
  await show("outer.mjs", () => import("./outer.mjs"));
});
