import { test } from "bun:test";
import "./environment.ts";
import { get } from "./barrel.ts";

test("reads the environment", () => {
  console.log("b", get());
});
