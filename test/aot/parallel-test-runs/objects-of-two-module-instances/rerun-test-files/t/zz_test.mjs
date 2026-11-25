import { test, expect, vi, mock } from "bun:test";
test.skip("mocks", () => { vi.doMock("../src/dep.mjs", () => ({ base: 2 })); });
