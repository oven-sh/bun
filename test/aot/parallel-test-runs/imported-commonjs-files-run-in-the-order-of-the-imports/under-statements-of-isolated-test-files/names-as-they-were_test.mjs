import { test } from "bun:test";
import "./names-as-they-were/root.mjs";
test("names-as-they-were", () => globalThis.call);
