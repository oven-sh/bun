import { test } from "bun:test";
import { list } from "./dep.mjs";
test("b", () => console.log("| b " + list.length));
