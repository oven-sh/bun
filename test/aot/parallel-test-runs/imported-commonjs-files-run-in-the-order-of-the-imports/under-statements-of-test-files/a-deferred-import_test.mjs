import { test } from "bun:test";
import "./a-deferred-import/root.mjs";
test("a-deferred-import", () => globalThis.call);
