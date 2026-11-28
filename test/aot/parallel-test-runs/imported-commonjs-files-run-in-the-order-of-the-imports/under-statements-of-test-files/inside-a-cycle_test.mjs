import { test } from "bun:test";
import "./inside-a-cycle/root.mjs";
test("inside-a-cycle", () => globalThis.call);
