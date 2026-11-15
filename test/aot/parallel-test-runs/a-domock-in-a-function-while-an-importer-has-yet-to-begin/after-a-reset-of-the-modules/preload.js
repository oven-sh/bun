import { vi } from "bun:test";
globalThis.mockDepOfPreload = factory => { vi.doMock("./dep.js", factory); };
