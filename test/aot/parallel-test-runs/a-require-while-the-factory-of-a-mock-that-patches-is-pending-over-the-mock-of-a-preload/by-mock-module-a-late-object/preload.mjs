import { vi } from "bun:test";
vi.mock("./part.cjs", () => ({ a: "of the preload", added: "of the preload" }));
globalThis.heldByThePreload = await import("./part.cjs");
