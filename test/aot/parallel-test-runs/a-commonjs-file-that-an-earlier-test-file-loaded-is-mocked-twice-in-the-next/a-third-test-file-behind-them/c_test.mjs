import { vi, mock, jest, test, afterEach } from "bun:test";
const look = async at => console.log("SAID", at, (await import("./part.cjs")).get(), (await import("./user.mjs")).seen());
test("c", async () => { await look("c"); vi.doMock("./part.cjs", () => ({ get: () => 8 })); await look("c under"); });
