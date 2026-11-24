import { vi } from "bun:test";
vi.mock("./lib.json");
await import("./lib.json");
