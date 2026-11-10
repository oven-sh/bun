import { mock, test, vi, jest } from "bun:test";
import { get } from "./part.cjs";
vi.mock("./part.cjs", () => ({ get: () => 6 }));
test("t", () => { vi.doMock("./part.cjs"); try { console.log("SAID", get()); } catch (error) { console.log("SAID threw", error.name); } });
