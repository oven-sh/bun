import { test } from "bun:test";
import { bump } from "./app.ts";
test("b", () => console.log("SAID old", bump()));
