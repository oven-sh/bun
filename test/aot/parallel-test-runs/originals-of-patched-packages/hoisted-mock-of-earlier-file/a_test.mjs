import { jest, test, vi } from "bun:test";
vi.mock("@made-up/tax", async () => ({ rate: (await import("./fx.mjs")).rate }));
test("a", () => console.log("a", jest.requireActual("@made-up/tax").rate));
