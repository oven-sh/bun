import { load } from "./harness.mjs";
import { test } from "vitest";
const { other } = await load();
test("second file", () => console.log("SAID b", other()));
