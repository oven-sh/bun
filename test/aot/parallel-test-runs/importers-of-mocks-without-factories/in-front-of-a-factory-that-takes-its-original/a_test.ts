import { test, vi, jest } from "bun:test";
import "./importer";
vi.mock("./dep");
vi.mock("./dep2", async (original: any) => ({ ...(await original()) }));
test("runs", async () => { console.log("test"); });
