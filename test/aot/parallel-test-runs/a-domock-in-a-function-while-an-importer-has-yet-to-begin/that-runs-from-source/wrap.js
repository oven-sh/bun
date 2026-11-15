import { vi } from "bun:test";
export const mockModule = (path, factory) => { vi.doMock(path, factory); };
