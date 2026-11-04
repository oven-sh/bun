import { vi } from "bun:test";
vi.doMock("./dep", () => ({ v: () => "mocked" }));
export const second = 2;
