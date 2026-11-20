import { test, vi } from "bun:test";
import { seen } from "./below-c.js";
vi.mock("node:fs", () => ({ default: { existsSync: () => "default of c" }, existsSync: () => "c" }));
test("c", () => console.log("c", String(seen())));
