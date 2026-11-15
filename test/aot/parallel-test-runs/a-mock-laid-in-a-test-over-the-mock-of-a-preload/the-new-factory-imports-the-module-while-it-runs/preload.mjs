import { vi } from "bun:test";
globalThis.callsOfThePreloadsFactory = 0;
vi.mock("./lib.mjs", async original => { globalThis.callsOfThePreloadsFactory++; return { ...(await original()) }; });
await import("./lib.mjs").catch(() => {});
