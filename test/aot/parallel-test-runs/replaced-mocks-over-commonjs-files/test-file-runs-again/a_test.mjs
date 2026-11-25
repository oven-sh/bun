import { mock, test, vi, jest } from "bun:test";
import * as all from "./part.cjs";
test("t", async () => { vi.doMock("./part.cjs", () => ({ limit: 0 })); mock.module("./part.cjs", () => ({ limit: 1 })); const again = await import("./part.cjs"); console.log("SAID", all.limit, again.limit, Object.keys(again).sort().join()); });
