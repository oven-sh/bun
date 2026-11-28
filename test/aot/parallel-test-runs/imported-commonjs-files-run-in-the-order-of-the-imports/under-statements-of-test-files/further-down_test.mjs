import { test } from "bun:test";
import "./further-down/root.mjs";
test("further-down", () => globalThis.call);
