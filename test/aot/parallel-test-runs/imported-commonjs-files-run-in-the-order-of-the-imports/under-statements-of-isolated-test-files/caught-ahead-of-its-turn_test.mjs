import { test } from "bun:test";
import "./caught-ahead-of-its-turn/root.mjs";
test("caught-ahead-of-its-turn", () => globalThis.call);
