import { beforeAll, test, vi } from "bun:test";
import { sold } from "./sale.mjs";
beforeAll(() => { vi.doMock("./tax.json", () => ({ rate: "bMock", default: { rate: "bMock" } })); });
test("b", () => console.log("b", sold()));
