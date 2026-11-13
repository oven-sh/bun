import { test } from "vitest";
import { other } from "./other.mjs";
test("first file", () => console.log("SAID a", other()));
