import { test, vi } from "bun:test";
vi.mock("./part.js", async importOriginal => { const original = await importOriginal(); globalThis.log.push("factory"); return { part: "mock " + original.part }; });
test("a", async () => { console.log("SAID", await import("./a.js").then(m => m.a(), e => e.name), await import("./a.js").then(m => m.a(), e => e.name), (globalThis.log ?? ["nothing"]).join(" ")); }, 3000);
