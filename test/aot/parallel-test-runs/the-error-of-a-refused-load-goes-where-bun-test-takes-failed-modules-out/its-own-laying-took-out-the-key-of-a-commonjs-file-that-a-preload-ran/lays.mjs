import { jest } from "bun:test";
jest.mock("./bin.cjs", () => ({ o: "of the preload" }));
await import("./bin.cjs");
