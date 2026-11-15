import { test } from "bun:test";
import { sold } from "./sale.mjs";
test("a", () => console.log("SAID a", sold()));
