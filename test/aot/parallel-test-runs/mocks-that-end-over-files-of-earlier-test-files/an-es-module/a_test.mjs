import { test } from "bun:test";
import { price } from "./prices.mjs";
test("the first file", () => console.log("first", price()));
