import { vi } from "bun:test";
vi.mock("pkg", () => ({ x: "preload" }));
