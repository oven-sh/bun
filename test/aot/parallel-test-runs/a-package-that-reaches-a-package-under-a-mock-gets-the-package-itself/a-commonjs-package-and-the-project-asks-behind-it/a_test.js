import { test, vi } from "bun:test";
import { seen } from "lamp";
import own from "./own.cjs";
vi.mock("wick", () => { globalThis.calls = (globalThis.calls || 0) + 1; return { width: () => "mocked" }; });
test("a", () => console.log(seen(), globalThis.calls, "|", own.seen(), globalThis.calls, "|", seen(), own.seen(), globalThis.bodies, globalThis.calls));
