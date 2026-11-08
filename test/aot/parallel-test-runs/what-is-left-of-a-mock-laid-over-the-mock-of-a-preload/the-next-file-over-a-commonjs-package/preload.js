import { mock } from "bun:test";
mock.module("widget", () => ({ who: "standing", other: "standing other" }));
globalThis.held = await import("widget");
globalThis.heldUser = (await import("./early.js")).viaEarly;
globalThis.heldBarrel = await import("./barrel.js");
