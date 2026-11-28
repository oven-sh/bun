import { test, mock, vi, jest, spyOn } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const said = m => Object.keys(m).join() + " shared:" + (typeof m.shared === "function" ? m.shared() : String(m.shared)) + " added:" + String(m.added);
const show = async (label, get) => { try { console.log(label, said(await get())); } catch (e) { console.log(label, "threw", e.name); } };
test("t", async () => {
  await import("./c.cjs");
  mock.module("./c.cjs", () => ({ shared: "patched c", added: "added by c" }));
  await show("ce.mjs", () => import("./ce.mjs"));
  await show("ec.mjs", () => import("./ec.mjs"));
});
