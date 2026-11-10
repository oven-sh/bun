import { vi } from "bun:test";
vi.doMock("./lib.mjs", () => ({ a: "2 in the graph", added: "2 in the graph", default: "2 in the graph" }));
