import { vi } from "bun:test";
globalThis.callsOfThePreload = 0;
vi.mock("./lib.mjs", async original => { globalThis.callsOfThePreload++; return { ...(await original()), a: "mocked" }; });
await import("./lib.mjs").catch(() => {});
