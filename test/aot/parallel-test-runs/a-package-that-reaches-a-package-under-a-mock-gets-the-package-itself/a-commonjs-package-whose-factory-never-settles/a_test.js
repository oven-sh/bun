import { test, vi } from "bun:test";
import { seen } from "lamp";
vi.mock("wick", () => new Promise(() => {}));
test("a", () => console.log(seen(), seen(), globalThis.bodies));
