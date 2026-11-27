import { test, vi, jest } from "bun:test";
import "./importer";
vi.mock("./dep", { spy: true });
test("runs", async () => { console.log("test"); });
