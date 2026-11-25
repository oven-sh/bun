import { vi } from "bun:test";
vi.mock("./dep.js", () => ({ who: "standing", other: "standing other" }));
globalThis.held = await import("./dep.js");
globalThis.heldUser = (await import("./early.js")).viaEarly;
