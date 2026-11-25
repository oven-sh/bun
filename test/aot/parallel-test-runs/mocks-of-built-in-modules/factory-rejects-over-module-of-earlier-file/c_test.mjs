import { test } from "bun:test";
import { top } from "./top.mjs";
test("c", () => console.log("SAID c", top()));
