import { vi, mock, jest } from "bun:test";
await import("./tray.mjs");
vi.doMock("./tray.mjs", () => ({ o: "preload tray" }));
