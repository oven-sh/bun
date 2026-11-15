import { vi } from "bun:test";
vi.mock("./dep.cjs", () => ({ value: () => "preload" }));
