import { test } from "bun:test";
import "./first.js";
import { seen } from "./second.js";
test("t", async () => {
  console.log("SAID in the test", seen());
  try { console.log("SAID asked", (await import("./dep.js")).who); } catch (e) { console.log("SAID asked threw", String(e.message).slice(0, 40)); }
});
