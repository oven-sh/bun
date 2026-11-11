import { test, vi } from "bun:test";
vi.mock("./part.js", async importOriginal => { const original = await importOriginal(); globalThis.log.push("factory"); return { part: "mock " + original.part }; });
vi.mock("./other.js", async () => { (globalThis.log ??= []).push("other"); globalThis.other = 1; await null; return { other: "mock" }; });
test("a", async () => { console.log("SAID", (await import("./a.js")).a(), (globalThis.log ?? ["nothing"]).join(" ")); }, 3000);
