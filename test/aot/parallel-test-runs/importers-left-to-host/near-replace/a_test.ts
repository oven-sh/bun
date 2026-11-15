import { it, vi } from "vitest";
vi.mock("./below.ts", () => ({ below: () => "replaced" }));
it("a", async () => { vi.resetModules(); console.log("a", (await import("./near.ts")).near()); });
