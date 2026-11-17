import { test, vi, jest } from "bun:test";
const read = (o, n) => { try { return String(o[n]); } catch { return "threw"; } };
const look = at => console.log("SAID", at, "| second", seen(), "| held", read(held, "who"), read(held, "other"), Object.keys(held).sort().join("+"), "| by a name", heldUser());
import "./first.js";
import { seen } from "./second.js";
test("t", async () => {
  look("at first");
  console.log("SAID asked", (await import("./dep.js")).who);
  console.log("SAID a new importer", (await import("./third.js")).viaThird());
  look("behind the loads");
});
