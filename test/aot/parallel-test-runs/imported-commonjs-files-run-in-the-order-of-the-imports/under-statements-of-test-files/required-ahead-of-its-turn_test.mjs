import { test } from "bun:test";
import "./required-ahead-of-its-turn/root.mjs";
test("required-ahead-of-its-turn", () => globalThis.call);
