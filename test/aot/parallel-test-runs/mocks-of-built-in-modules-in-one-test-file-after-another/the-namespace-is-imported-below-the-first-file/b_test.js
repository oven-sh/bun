import { test, vi } from "bun:test";
import { seen } from "./below-b.js";
vi.mock("node:fs", () => ({ default: { existsSync: () => "default of b" }, existsSync: () => "b" }));
test("b", () => console.log("b", String(seen())));
