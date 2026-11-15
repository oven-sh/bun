import { vi } from "bun:test";
vi.mock("./dep.mjs", () => ({ x: "preload" }));
