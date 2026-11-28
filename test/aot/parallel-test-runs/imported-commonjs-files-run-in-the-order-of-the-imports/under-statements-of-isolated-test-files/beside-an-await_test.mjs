import { test } from "bun:test";
import "./beside-an-await/root.mjs";
test("beside-an-await", () => globalThis.call);
