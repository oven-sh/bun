import { vi } from "bun:test";
vi.mock("./lib.cjs", async original => ({ ...(await original()), a: "mocked" }));
globalThis.heldByThePreload = await import("./lib.cjs");
