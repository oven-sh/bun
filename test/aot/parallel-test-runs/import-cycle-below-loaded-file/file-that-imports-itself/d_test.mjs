import { test, vi } from "bun:test";
import { other } from "./other.mjs";
test("d", () => { vi.resetModules(); console.log("SAID d", other()); });
