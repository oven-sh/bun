import { mock } from "bun:test";
mock.module("./tray.mjs", () => ({ o: "preload tray" }));
