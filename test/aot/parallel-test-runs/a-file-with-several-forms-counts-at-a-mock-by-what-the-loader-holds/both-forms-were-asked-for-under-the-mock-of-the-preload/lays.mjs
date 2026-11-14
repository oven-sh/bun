import { jest } from "bun:test";
jest.mock("./bin.json", () => ({ o: "of the preload" }));
await import("./bin.json");
await import("./bin.json", { with: { type: "text" } });
