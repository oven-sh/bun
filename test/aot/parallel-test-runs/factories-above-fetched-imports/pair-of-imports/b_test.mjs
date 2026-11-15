import { load } from "./harness.mjs";
import { test } from "vitest";
import { other } from "./other.mjs";
test("second file", () => console.log("SAID b", other(), typeof load));
