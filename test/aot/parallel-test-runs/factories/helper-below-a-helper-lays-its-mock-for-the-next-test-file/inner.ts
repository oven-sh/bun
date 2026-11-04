import { vi } from "bun:test";

vi.doMock("./fee", () => ({ fee: "mock fee" }));
