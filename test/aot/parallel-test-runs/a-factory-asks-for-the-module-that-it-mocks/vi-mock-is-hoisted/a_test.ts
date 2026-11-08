// vi.mock() is hoisted above the import of the module that it mocks, and its factory asks for that module.
import { test, vi } from "bun:test";
import { rate, fee } from "./tax";
vi.mock("./tax", async () => ({ ...(await import("./tax")), rate: "mock rate" }));
test("a", () => { console.log("a", rate, fee); });
