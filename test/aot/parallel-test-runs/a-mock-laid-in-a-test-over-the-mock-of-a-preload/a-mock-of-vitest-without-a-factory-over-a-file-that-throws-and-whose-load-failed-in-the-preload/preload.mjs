import { vi } from "bun:test";
vi.mock("./lib.mjs", async original => ({ ...(await original()), a: "mocked" }));
await import("./lib.mjs").catch(() => {});
