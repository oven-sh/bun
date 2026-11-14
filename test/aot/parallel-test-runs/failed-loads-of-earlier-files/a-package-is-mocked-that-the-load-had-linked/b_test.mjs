import { jest, mock, test, vi } from "bun:test";
import { sold } from "./sale.mjs";
vi.mock("@made-up/fx", () => ({ ...require("@made-up/fx"), rate: "mock rate" }));
test("b", () => {
  console.log("b", sold());
  vi.doUnmock("@made-up/fx");
  vi.doMock("./tax.mjs", { spy: true });
  console.log("actual", jest.requireActual("./tax.mjs").below());
});
