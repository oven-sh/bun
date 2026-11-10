import { test, vi, jest } from "bun:test";
import { order } from "./log.js";
import { a } from "./a.js";
vi.mock("./part.js", async importOriginal => { order.push("F<"); const original = await importOriginal(); order.push("F-orig"); await 0; order.push("F>"); return { part: "mock " + original.part }; });
test("t", async () => console.log(`| SAID ${a()} : ${order.join(" ")}`));
