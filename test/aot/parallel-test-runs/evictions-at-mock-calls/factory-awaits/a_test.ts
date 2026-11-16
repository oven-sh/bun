import { it, vi } from "vitest";
it("a", async () => { vi.resetModules(); console.log("a", (await import("./base")).base); });
