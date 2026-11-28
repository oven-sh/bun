import { test } from "bun:test";
import "./an-import-is-missing/root.mjs";
test("an-import-is-missing", () => globalThis.call);
