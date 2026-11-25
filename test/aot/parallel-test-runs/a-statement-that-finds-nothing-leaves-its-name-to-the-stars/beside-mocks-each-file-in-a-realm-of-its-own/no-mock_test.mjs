import { test } from "bun:test";
import { measure, paint } from "./index.mjs";
import { say } from "./show.mjs";
test("nothing is mocked", async () => {
  console.log("| CASE by name |", measure, paint);
  await say("over a CommonJS file", () => import("./index.mjs"));
  await say("over an ES module", () => import("./over-an-es-module.mjs"));
});
