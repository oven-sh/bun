import { test } from "bun:test";
import { w } from "./w.mjs";
import { middle } from "./middle.mjs";
test("a", () => console.log("SAID a", w(), middle()));
