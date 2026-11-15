import { jest, test } from "bun:test";
jest.mock("@made-up/tax", () => ({ rate: "mock", under: () => "mock" }));
test("b", () => console.log("b", jest.requireActual("@made-up/tax").rate));
