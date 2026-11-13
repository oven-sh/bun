import { test, expect, vi, mock } from "bun:test";
test("mocks", () => { vi.doMock("../src/dep.mjs", () => ({ base: 2 })); });
