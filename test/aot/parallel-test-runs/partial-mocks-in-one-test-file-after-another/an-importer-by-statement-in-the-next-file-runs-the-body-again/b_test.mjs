import { test } from "bun:test";
import { seen } from "./user.mjs";
test("b", () => console.log("| b " + seen));
