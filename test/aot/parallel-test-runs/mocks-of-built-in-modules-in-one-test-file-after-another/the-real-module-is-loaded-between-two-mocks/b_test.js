import { test, vi } from "bun:test";
import { seen } from "./below-b.js";
test("b", () => console.log("b", String(seen())));
