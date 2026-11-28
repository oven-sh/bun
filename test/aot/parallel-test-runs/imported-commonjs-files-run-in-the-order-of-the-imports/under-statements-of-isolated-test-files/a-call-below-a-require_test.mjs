import { test } from "bun:test";
import "./a-call-below-a-require/root.mjs";
test("a-call-below-a-require", () => globalThis.call);
