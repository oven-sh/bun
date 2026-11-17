import { mock, test, vi, jest } from "bun:test";
import { get } from "./part.mjs";
vi.mock("./part.mjs", () => ({ get: () => 6 }));
test("t", () => { vi.doMock("./part.mjs", { spy: true }); try { console.log("SAID", get()); } catch (error) { console.log("SAID threw", error.name); } });
