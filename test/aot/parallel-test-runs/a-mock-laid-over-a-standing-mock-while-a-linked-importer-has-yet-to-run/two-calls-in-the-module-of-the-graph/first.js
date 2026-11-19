import { vi } from "bun:test";
vi.doMock("./dep.js", () => ({ who: "one" }));
vi.doMock("./dep.js", () => ({ who: "two" }));
