import { test, vi } from "bun:test";
import { a } from "./a.js";
vi.mock("./part.js", async importOriginal => ({ part: "mock " + (await import("./b.js")).readA() }));
test("t", () => console.log(`| SAID ${a()}`));
