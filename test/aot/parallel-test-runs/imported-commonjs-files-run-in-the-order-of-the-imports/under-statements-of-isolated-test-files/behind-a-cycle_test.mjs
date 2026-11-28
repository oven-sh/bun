import { test } from "bun:test";
import "./behind-a-cycle/root.mjs";
test("behind-a-cycle", () => globalThis.call);
