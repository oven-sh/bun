import { mock } from "bun:test";
mock.module("./dep.js", () => ({ who: "standing", other: "standing other" }));
globalThis.held = await import("./dep.js");
globalThis.heldUser = (await import("./early.js")).viaEarly;
globalThis.heldBarrel = await import("./barrel.js");
