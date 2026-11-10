import { test, vi } from "bun:test";
vi.mock("./early.js", async () => { globalThis.runs = (globalThis.runs ?? "") + "E"; await null; return { early: "mock" }; });
vi.mock("./deep.js", () => { globalThis.runs = (globalThis.runs ?? "") + "D"; globalThis.laid = "deep"; return { deep: "mock" }; });
vi.mock("./part.js", async importOriginal => { globalThis.runs = (globalThis.runs ?? "") + "F"; return { part: "mock " + (await importOriginal()).part }; });
test("t", async () => { const got = await import("./a.js").then(m => m.a(), e => e.name); console.log("| SAID " + got + " | " + globalThis.seen + " | " + globalThis.runs); });

