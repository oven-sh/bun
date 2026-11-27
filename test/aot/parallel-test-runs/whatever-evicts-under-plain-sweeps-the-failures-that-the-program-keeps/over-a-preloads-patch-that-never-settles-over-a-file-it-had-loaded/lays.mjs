import { mock } from "bun:test";
await import("./tray.mjs");
mock.module("./tray.mjs", () => new Promise(() => {}));
