import { test } from "bun:test";
import { other } from "./other.mjs";
test("c", () => console.log("SAID c", other()));
