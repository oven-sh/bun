import { vi } from "bun:test";
vi.doMock("./gauge.mjs", () => ({ lent: 1 }));
