import { test } from "bun:test";
import { app } from "./app";
import { greet } from "./dep";

test("the next file", () => {
  console.log("next", greet(), app());
});
