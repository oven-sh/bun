import { mock, test, vi, jest } from "bun:test";
import { get } from "./part.mjs";
vi.mock("./part.mjs", () => ({ get: () => 6 }));
test("t", () => { try { vi.doMock("./part.mjs"); console.log("SAID the call returned", get()); } catch (error) { console.log("SAID the call threw", error.name); } });
