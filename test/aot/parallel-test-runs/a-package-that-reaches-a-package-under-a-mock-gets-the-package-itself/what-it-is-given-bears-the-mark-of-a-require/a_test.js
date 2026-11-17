import { test, vi } from "bun:test";
import { seen } from "lamp";
vi.mock("wick", () => ({ width: () => "mocked", default: { width: () => "mocked default" } }));
test("a", () => console.log(seen()));
