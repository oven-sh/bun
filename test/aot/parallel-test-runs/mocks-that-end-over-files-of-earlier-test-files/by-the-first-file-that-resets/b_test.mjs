import { test } from "bun:test";
import { price } from "./prices.mjs";
test("reads", () => console.log("second", price()));
