import { test } from "bun:test";
test("comes behind", () => require("./requires.cjs").say());
