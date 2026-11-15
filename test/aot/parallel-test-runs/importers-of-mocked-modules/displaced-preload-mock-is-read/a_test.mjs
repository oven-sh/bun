import { test, vi } from "bun:test";
vi.mock("./leaf.mjs", async () => ({ leaf: "never loaded" }));
test("a", () => {});
