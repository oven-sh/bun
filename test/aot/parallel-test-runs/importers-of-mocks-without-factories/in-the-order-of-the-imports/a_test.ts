import { test, vi, jest } from "bun:test";
import "./importer";
vi.mock("./dep");
test("runs", async () => { console.log("test"); });
