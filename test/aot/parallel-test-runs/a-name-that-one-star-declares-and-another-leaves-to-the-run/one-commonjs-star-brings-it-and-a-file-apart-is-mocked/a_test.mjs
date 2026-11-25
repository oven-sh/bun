import { test, mock } from "bun:test";
import * as outer from "./outer.mjs";
import { near } from "./apart.mjs";
mock.module("./apart.mjs", () => ({ near: 2 }));
test("the name that two stars bring is left out", () => {
  console.log("SAID", typeof outer.round, Object.keys(outer).join(), near);
});
