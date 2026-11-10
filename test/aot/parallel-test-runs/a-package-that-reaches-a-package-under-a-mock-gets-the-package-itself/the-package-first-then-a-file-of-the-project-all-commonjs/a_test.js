import { test, vi } from "bun:test";
import { seen } from "lamp";
import own from "./own.cjs";
vi.mock("wick", () => { globalThis.calls = (globalThis.calls || 0) + 1; return { width: () => "mocked" }; });
test("t", async () => console.log("SAID " + own.seen() + " " + seen() + " " + own.seen() + " | bodies " + globalThis.bodies + " calls " + globalThis.calls));
