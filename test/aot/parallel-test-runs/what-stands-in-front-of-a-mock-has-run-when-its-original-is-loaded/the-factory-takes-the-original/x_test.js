import { test, vi } from "bun:test";
import { order } from "./log.js";
import { a } from "./a.js";
vi.mock("./part.js", async importOriginal => { const original = await importOriginal(); order.push("factory"); return { part: "mock " + original.part }; });
test("t", () => console.log(`| SAID ${a()} ${order.join(" ")}`));
