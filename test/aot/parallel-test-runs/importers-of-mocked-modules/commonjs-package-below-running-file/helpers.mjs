import { vi } from "bun:test";
export const install = () => vi.doMock("kiln", () => ({ default: { fire: () => "mock" }, fire: () => "mock" }));
