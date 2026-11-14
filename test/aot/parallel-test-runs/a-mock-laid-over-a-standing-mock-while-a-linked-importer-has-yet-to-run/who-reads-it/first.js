import { vi } from "bun:test";
vi.doMock("./dep.js", () => ({ who: "later", more: "later more" }));
