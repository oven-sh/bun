import { vi, mock, jest } from "bun:test";
mock.module("./tray.mjs", () => ({ o: "preload tray" }));
