import { vi } from "bun:test";
vi.doMock("./dep.cjs", () => ({ who: "later", more: "later more" }));
