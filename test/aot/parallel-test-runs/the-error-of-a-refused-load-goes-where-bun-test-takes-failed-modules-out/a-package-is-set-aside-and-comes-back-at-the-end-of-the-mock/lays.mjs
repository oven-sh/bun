import { jest } from "bun:test";
jest.mock("binpkg", () => ({ o: "of the preload" }));
await import("binpkg");
