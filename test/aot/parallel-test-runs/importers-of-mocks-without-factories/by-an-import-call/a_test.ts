import { test, vi, jest } from "bun:test";
vi.mock("./dep");
test("runs", async () => { await import("./importer"); console.log("test"); });
