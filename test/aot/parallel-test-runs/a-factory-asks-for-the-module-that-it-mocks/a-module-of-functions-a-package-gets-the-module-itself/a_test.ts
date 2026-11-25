// A package gets the module itself beside a mock of vi.mock(), and the module holds function declarations alone.
import { test, vi } from "bun:test";
import { ask } from "asks";
vi.mock("./tax", () => ({ rate: () => "mock rate", fee: () => "mock fee" }));
test("a", async () => { const tax = await import("./tax"); console.log("a", tax.rate(), await ask()); });
