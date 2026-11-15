import { vi } from "bun:test";
await import("./tray.mjs");
vi.doMock("./tray.mjs", () => new Promise(() => {}));
