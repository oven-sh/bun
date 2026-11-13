import { test } from "bun:test";
import { other } from "./other.mjs";
test("a", () => console.log("SAID a", other()));
