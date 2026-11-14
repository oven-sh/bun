import { test, vi } from "bun:test";
test.skip("mocks another file", () => { vi.doMock("../src/other.mjs", () => ({ other: 2 })); });
