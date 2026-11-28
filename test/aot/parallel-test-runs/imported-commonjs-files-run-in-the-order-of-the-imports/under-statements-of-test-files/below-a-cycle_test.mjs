import { test } from "bun:test";
import "./below-a-cycle/root.mjs";
test("below-a-cycle", () => globalThis.call);
