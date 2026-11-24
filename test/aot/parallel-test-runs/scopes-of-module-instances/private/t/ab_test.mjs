import { test, expect, vi, mock } from "bun:test";
const say = (...all) => console.log("SAID", ...all);
test("mocks", () => { vi.doMock("../src/dep.mjs", () => ({ base: 2 })); });
