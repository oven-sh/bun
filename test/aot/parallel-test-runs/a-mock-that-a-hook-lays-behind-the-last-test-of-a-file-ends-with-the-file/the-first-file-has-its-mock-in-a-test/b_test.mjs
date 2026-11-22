import { test } from "bun:test";

test("requires the kettle", () => {
  const { sound, cups } = require("./kettle.cjs");
  console.log("second:", sound, cups);
});
