import { vi } from "bun:test";
vi.mock("./dep.cjs", () => ({ who: "standing", other: "standing other" }));
globalThis.held = await import("./dep.cjs");
globalThis.heldUser = (await import("./early.js")).viaEarly;
