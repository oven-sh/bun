import { beforeAll, test, vi } from "bun:test";
import { sold } from "./sale.mjs";
beforeAll(() => { vi.doMock("./tax.json", async () => ({ ...(await vi.importActual("./tax.json")), rate: "bMock" })); });
test("b", () => console.log("b", sold()));
