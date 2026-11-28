import { test } from "bun:test";
import "./a-commonjs-file-throws/root.mjs";
test("a-commonjs-file-throws", () => globalThis.call);
