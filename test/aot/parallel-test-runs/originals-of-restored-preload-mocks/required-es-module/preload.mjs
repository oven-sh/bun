import { vi } from "bun:test";
vi.mock("./dep.mjs", () => ({ value: () => "preload" }));
