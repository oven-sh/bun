import { test, vi } from "bun:test";
import { seen } from "lamp";
vi.mock("wick", () => { globalThis.calls = (globalThis.calls || 0) + 1; return { width: () => "mocked" }; });
test("a", () => console.log(seen(), seen(), globalThis.bodies, globalThis.calls));
