import { vi, jest, beforeEach } from "bun:test";
beforeEach(() => { vi.doMock("./api.ts"); });
