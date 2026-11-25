import { test, vi } from "bun:test";
import { order } from "./log.js";
vi.mock("./part.js", async importOriginal => { const original = await importOriginal(); order.push("factory"); return { part: "mock " + original.part }; });
test("t", async () => console.log(`| SAID ${(await import("./a.js")).a()} ${order.join(" ")}`));
