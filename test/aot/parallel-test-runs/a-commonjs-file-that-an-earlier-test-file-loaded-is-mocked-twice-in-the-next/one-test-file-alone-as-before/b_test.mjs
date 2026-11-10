import { seen } from "./user.mjs";
import { vi, mock, jest, test, afterEach } from "bun:test";
const look = async at => console.log("SAID", at, (await import("./part.cjs")).get(), (await import("./user.mjs")).seen());
afterEach(() => { vi.doUnmock("./part.cjs"); });
test("one", async () => { vi.doMock("./part.cjs", () => ({ get: () => 5 })); await look("one"); });
test("real", async () => { await look("real"); });
test("two", async () => { vi.doMock("./part.cjs", () => ({ get: () => 6 })); await look("two"); });
