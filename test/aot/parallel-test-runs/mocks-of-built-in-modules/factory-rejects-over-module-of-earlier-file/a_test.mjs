import { test } from "bun:test";
import { top } from "./top.mjs";
test("a", () => console.log("SAID a", top()));
