import { vi } from "bun:test";
vi.doMock("./gauge.cjs", () => ({ lent: 1 }));
