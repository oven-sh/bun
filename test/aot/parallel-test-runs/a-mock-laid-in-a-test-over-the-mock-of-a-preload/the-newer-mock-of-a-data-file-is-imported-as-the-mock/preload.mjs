import { vi } from "bun:test";
vi.mock("./lib.json", () => ({ a: "of the preload" }));
await import("./lib.json");
