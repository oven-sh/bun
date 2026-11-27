import { test } from "bun:test";
import { get } from "./api.ts";
import "./broken.cjs";
import "./next.ts";

test("reads", () => {
  console.log("b", get());
});
