import { expect, test, vi } from "bun:test";
vi.mock("./rate", async original => { await import("./chain"); return { rate: "mock" }; });
test("t", async () => { expect((await import("./rate")).rate).toBe("mock"); });
