import { test } from "bun:test";
import { other } from "./other.js";
test("a", () => { console.log("SAID a", other); });
