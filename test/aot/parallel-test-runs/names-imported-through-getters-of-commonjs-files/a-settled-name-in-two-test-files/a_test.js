import { test } from "bun:test";
import { twice, width } from "./fixed-door.cjs";
test("a", () => { console.log("a", twice(width)); require("./fixed.cjs").width = 10; console.log("a", width, require("./fixed-door.cjs").width); });
