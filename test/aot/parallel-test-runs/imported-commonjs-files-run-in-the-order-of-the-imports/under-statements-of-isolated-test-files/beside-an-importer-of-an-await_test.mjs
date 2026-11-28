import { test } from "bun:test";
import "./beside-an-importer-of-an-await/root.mjs";
test("beside-an-importer-of-an-await", () => globalThis.call);
