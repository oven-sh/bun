import { test, vi } from "bun:test";
test.skip("mocks", () => { vi.doMock("./dep.mjs", () => ({ step: 2 })); });
