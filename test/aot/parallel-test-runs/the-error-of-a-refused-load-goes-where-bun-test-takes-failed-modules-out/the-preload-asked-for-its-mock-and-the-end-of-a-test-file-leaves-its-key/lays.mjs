import { jest } from "bun:test";
jest.mock("./part.mjs", () => ({ o: "of the preload" }));
await import("./part.mjs");
await import("./part.mjs", { with: { type: "text" } });
