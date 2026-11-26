import { mock, test } from "bun:test";
import { writeFileSync } from "node:fs";
const late = import.meta.dir + "/" + (process.env.NAME_THAT_NOBODY_SETS ?? "late") + ".cjs";
export function mentionsIt() { return require("./held.cjs"); }
test("second", () => {
  mock.module("./absent.cjs", () => ({ v: "two" }));
  const late_ = require(late), held = require("./held.cjs");
  console.log("SAID", late_.held === held);
});
