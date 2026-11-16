import { vi } from "bun:test";
vi.mock("./lib.cjs", async () => { await 0; return { a: "mocked", n: -1 }; });
