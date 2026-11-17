import { jest, mock, test, vi } from "bun:test";
import { sold } from "./sale.mjs";
vi.mock("@made-up/fx", () => ({ rate: "mock rate" }));
test("b", async () => {
  console.log("b", sold());
  vi.doUnmock("@made-up/fx");
  vi.doMock("./tax.mjs", () => ({ below: () => "mock below" }));
  console.log("again", (await import("./sale.mjs")).sold(), jest.requireActual("./tax.mjs").below());
});
