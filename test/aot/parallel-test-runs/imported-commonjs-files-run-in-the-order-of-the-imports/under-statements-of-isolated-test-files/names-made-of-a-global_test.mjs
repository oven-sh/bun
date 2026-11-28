import { test } from "bun:test";
import "./names-made-of-a-global/root.mjs";
test("names-made-of-a-global", () => globalThis.call);
