import { test, vi } from "bun:test";
import { a } from "./a.js";
vi.mock("./part.js", async importOriginal => { const original = await importOriginal(); const { c } = await import("./c.js"); return { part: `mock ${original.part} ${c}` }; });
test("t", () => console.log(`| SAID ${a()}`));
