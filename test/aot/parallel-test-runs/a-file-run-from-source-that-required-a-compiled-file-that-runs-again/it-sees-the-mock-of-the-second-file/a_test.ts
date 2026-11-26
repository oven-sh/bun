import { mock, test } from "bun:test";
import { writeFileSync } from "node:fs";
const late = import.meta.dir + "/" + (process.env.NAME_THAT_NOBODY_SETS ?? "late") + ".cjs";
export function mentionsIt() { return require("./held.cjs"); }
test("first", () => {
  writeFileSync(late, `const held = require("./held.cjs"); exports.v = "late:" + held.v; exports.held = held;`);
  mock.module("./absent.cjs", () => ({ v: "one" }));
  console.log("SAID", require(late).v);
});
