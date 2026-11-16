import { test, vi } from "bun:test";
import { a } from "./a.js";
vi.mock("./part.js", async importOriginal => { const b = await import("./b.js"); const seen = b.readA(); const original = await importOriginal(); return { part: `mock ${original.part} ${seen}` }; });
test("t", () => console.log(`| SAID ${a()}`));
