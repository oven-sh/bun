import { test, vi, jest } from "bun:test";
import { order } from "./log.js";
import { a } from "./a.js";
vi.mock("./part.js", async importOriginal => { order.push("factory-begins"); const original = await importOriginal(); order.push("factory-has-original"); await 0; order.push("factory-ends"); return { part: "mock " + original.part }; });
test("t", () => console.log(`| SAID ${a()} : ${order.join(" ")}`));
