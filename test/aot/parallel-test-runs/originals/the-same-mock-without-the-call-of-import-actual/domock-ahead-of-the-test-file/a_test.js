import { test, vi } from "bun:test";
import "./first.js";
import { who, count } from "./m.js";
test("a mock is laid by what the test file imports first", () => {
  console.log("test file reads", who, count());
});
