import { test } from "bun:test";
import "./a-name-is-missing/root.mjs";
test("a-name-is-missing", () => globalThis.call);
