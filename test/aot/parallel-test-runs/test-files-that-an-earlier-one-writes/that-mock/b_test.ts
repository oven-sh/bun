import { test, mock } from "bun:test";
mock.module("./app.ts", () => ({ bump: () => "mocked old" }));
import { bump } from "./app.ts";
test("b", () => console.log("SAID old", bump()));
