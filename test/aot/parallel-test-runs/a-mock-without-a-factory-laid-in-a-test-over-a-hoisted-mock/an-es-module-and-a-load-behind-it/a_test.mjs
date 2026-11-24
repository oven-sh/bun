import { mock, test, vi, jest } from "bun:test";
import { get } from "./part.mjs";
vi.mock("./part.mjs", () => ({ get: () => 6 }));
test("t", async () => { vi.doMock("./part.mjs"); const again = await import("./part.mjs"); console.log("SAID", get(), typeof again.get, String(again.get())); });
