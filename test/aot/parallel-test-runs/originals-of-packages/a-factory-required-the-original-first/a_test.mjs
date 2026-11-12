import { jest, mock, test, vi } from "bun:test";
import { sold } from "./sale.mjs";
jest.doMock("@made-up/fx", () => ({ ...jest.requireActual("@made-up/fx"), rate: "first" }));
jest.mock("@made-up/fx", () => ({ ...require("@made-up/fx"), rate: "second" }));
test("a", () => {
  console.log("a", typeof sold);
});
