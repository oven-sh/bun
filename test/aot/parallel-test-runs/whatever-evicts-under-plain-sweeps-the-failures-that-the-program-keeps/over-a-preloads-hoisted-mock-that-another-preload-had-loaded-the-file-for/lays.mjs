import { vi } from "bun:test";
vi.mock("./tray.mjs", () => ({ o: "preload tray" }));
await import("./tray.mjs");
