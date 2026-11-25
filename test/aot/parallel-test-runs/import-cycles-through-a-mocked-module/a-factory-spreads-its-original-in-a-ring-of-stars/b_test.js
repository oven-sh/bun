import { test } from "bun:test";
import { seen } from "./user.js";
test("b", () => console.log("| CASE b", seen()));
