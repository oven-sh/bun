import { test } from "bun:test";
import "./jobs-and-ticks/root.mjs";
test("jobs-and-ticks", () => globalThis.call);
