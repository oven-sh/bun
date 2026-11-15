import { vi } from "bun:test";
vi.mock("./part.mjs", async original => ({ ...(await original()) }));
await import("./part.mjs").catch(() => {});
