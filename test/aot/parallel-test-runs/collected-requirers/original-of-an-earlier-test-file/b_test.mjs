import { jest, test } from "bun:test";
jest.mock("@made-up/tax", () => ({ rate: "mock", under: () => "mock" }));
test("b", () => (Bun.gc(true), 0) || console.log("b", jest.requireActual("@made-up/tax").rate));
