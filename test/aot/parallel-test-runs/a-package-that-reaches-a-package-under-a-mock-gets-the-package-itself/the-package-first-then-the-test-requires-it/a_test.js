import { test, vi } from "bun:test";
import { seen } from "lamp";
vi.mock("wick", () => { globalThis.calls = (globalThis.calls || 0) + 1; return { width: () => "mocked" }; });
test("t", async () => console.log("SAID " + require("wick").width() + " " + seen() + " " + require("wick").width() + " | bodies " + globalThis.bodies + " calls " + globalThis.calls));
