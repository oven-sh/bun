import { test } from "bun:test";
import { seen } from "./user.mjs";
test("a", () => console.log("SAID a", seen()));
import { also } from "./other.mjs";
test("a2", () => console.log("SAID a2", also()));
