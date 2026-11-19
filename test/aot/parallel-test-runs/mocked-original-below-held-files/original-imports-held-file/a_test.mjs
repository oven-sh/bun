import { test } from "bun:test";
import { launch } from "./support.mjs";
test("launch", () => console.log("SAID", launch()));
