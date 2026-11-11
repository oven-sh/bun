import { test } from "bun:test";
import { twice, width } from "./hall.mjs";
test("b", () => { console.log("b", twice(width), require("./fixed-door.cjs").width); });
