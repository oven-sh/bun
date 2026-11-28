import { test } from "bun:test";
import "./among-es-modules/root.mjs";
test("among-es-modules", () => globalThis.call);
