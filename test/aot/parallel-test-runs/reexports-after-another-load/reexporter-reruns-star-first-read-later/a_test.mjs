import { test, vi } from "bun:test";
import { leaf } from "./leaf.mjs";
import "./b_test.mjs";
globalThis.dRuns = (globalThis.dRuns ?? 0) + 1;
export let value = globalThis.dRuns * 100 + leaf;
export const bump = () => ++value;
globalThis.bumpD = bump;
test("d", () => { console.log("SAID d", globalThis.dRuns, value); });
test.skip("mocks", () => { vi.doMock("./leaf.mjs", () => ({ leaf: 2 })); });
