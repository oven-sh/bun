import { afterEach, jest, mock, vi } from "bun:test";

mock.module("./clock.ts", () => ({ ...jest.requireActual("./clock.ts"), hour: () => "noon" }));

afterEach(() => {
  vi.doMock("./clock.ts");
});
