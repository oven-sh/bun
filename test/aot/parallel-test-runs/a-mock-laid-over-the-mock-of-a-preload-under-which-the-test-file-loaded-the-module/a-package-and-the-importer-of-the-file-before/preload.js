import { vi } from "bun:test";
vi.mock("widget", () => ({ who: "standing" }));
await import("widget");
globalThis.heldEarly = (await import("./early.js")).viaEarly;
