import { test, vi, mock, jest } from "bun:test";
test("t", async () => { vi.doMock("made-up-pkg", async original => ({ ...(await original()), get: () => 0 })); const all = await import("made-up-pkg"); all.bump(); console.log("SAID", all.count, all.get()); vi.doUnmock("made-up-pkg"); const real = await import("made-up-pkg"); console.log("SAID", real.count, real.get(), all.get()); });
