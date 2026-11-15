import { mock } from "bun:test";
mock.module("./dep.cjs", () => ({ who: "standing", other: "standing other" }));
globalThis.held = await import("./dep.cjs");
globalThis.heldUser = (await import("./early.js")).viaEarly;
globalThis.heldBarrel = await import("./barrel.js");
