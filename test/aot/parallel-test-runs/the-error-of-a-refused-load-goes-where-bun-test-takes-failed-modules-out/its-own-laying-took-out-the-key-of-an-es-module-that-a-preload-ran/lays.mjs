import { jest } from "bun:test";
jest.mock("./bin.mjs", () => ({ o: "of the preload" }));
await import("./bin.mjs");
