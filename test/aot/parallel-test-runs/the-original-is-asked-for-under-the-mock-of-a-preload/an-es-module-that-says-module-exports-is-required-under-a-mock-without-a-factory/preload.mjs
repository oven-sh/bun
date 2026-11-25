import { vi } from "bun:test";
vi.mock("./lib.mjs");
await import("./lib.mjs");
