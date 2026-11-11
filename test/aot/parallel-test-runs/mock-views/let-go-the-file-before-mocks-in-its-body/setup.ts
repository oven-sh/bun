import { vi } from "bun:test";
vi.doMock("./dep", () => ({ value: () => "mock b" }));
