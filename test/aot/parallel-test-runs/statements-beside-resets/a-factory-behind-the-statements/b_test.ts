import { test } from "bun:test";
import "./one.ts";
import { get } from "./barrel.ts";
import "./two.ts";

test("reads", () => {
  console.log("b", get());
});
