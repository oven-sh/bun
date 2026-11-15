import { mock, vi } from "bun:test";
export const mockModule = (path, factory) => { vi.doMock(path, factory); };
export const layModule = (path, factory) => { mock.module(path, factory); };
