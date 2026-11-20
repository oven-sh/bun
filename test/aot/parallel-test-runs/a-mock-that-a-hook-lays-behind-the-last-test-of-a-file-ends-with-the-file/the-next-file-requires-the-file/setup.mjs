import { afterEach, jest, mock, vi } from "bun:test";

mock.module("./anchor.cjs", () => ({ ...jest.requireActual("./anchor.cjs"), chain: "rope of the preload" }));
const { holds } = await import("./ship.mjs");
holds();

afterEach(() => {
  vi.doMock("./anchor.cjs", () => ({ weight: 1, chain: "thread of the hook" }));
});
