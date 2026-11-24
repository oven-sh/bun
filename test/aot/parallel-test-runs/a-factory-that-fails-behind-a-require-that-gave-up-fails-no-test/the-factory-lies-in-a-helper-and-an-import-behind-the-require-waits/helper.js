import { vi } from "bun:test";
export const lay = () => { vi.doMock("./kiln.js", () => new Promise(() => {})); };
