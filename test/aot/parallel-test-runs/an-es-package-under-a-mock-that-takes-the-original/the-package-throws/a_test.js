import { test, vi, mock, jest } from "bun:test";
test("t", async () => { vi.doMock("made-up-pkg", async original => ({ ...(await original()) })); for (const turn of [1, 2]) console.log("SAID", turn, await import("made-up-pkg").then(all => all.get(), error => error.message)); });
