import { vi } from "bun:test";

vi.mock("./dep", () => ({ flag: "mock" }));
