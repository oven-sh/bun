import { it, vi } from "vitest";
vi.mock("./below.ts", async importOriginal => ({ ...(await importOriginal()), below: () => "replaced" }));
it("a", async () => { vi.resetModules(); console.log("a", (await import("./user.ts")).user()); });
