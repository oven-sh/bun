import { test, vi, jest } from "bun:test";
const read = (o, n) => { try { return String(o[n]); } catch { return "threw"; } };
const look = at => console.log("SAID", at, "| second", seen(), "| held", read(held, "who"), read(held, "other"), Object.keys(held).sort().join("+"), "| by a name", heldUser());
import { seen } from "./second.js";
test("u", () => look("the next file"));
