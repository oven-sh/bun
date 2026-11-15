import { test, vi } from "bun:test";
import { seen } from "./below-a.js";
vi.mock("node:fs", () => ({ default: { existsSync: () => "default of a" }, existsSync: () => "a" }));
test("a", () => console.log("a", String(seen())));
