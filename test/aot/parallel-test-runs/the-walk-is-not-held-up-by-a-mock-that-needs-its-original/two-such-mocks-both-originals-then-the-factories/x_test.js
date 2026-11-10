import { test, vi } from "bun:test";
import { order } from "./log.js";
import { a } from "./a.js";
vi.mock("./part.js", async importOriginal => { order.push("factory-part-begins"); const original = await importOriginal(); order.push("factory-part-ends " + original.seesRing()); return { part: "mock " + original.part }; });
vi.mock("./other.js", async importOriginal => { order.push("factory-other-begins"); const original = await importOriginal(); order.push("factory-other-ends " + original.seesRing()); return { other: "mock " + original.other }; });
test("t", () => console.log(`| SAID ${a()} : ${order.join(" ")}`));
