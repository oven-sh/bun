import { test } from "bun:test";
import "./an-es-module-throws/root.mjs";
test("an-es-module-throws", () => globalThis.call);
