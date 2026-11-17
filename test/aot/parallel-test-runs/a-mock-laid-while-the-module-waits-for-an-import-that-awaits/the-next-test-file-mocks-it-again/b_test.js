import { test, vi } from "bun:test";
globalThis.gate = 0;
test("b", async () => { vi.doMock("./a.mjs", () => ({ get: () => "second" })); const held = await import("./b.mjs"); console.log("SAID b under", held.read()); vi.doUnmock("./a.mjs"); console.log("SAID b ended", held.read(), (await import("./a.mjs")).get()); });
