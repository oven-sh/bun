import { mock, test, vi, jest } from "bun:test";
import * as all from "./part.mjs";
test("t", async () => { vi.doMock("./part.mjs", () => ({ limit: 0 })); mock.module("./part.mjs", () => ({ limit: 1 })); const again = await import("./part.mjs"); console.log("SAID", all.limit, again.limit, Object.keys(again).sort().join()); });
