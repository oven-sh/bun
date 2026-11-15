import { vi } from "bun:test";
export const mockPackage = factory => { vi.doMock("mocked-commonjs-package", factory); };
