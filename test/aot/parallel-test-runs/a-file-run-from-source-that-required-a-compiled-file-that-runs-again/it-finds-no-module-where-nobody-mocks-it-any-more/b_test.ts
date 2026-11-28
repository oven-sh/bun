import { mock, test } from "bun:test";
import { writeFileSync } from "node:fs";
const late = import.meta.dir + "/" + (process.env.NAME_THAT_NOBODY_SETS ?? "late") + ".cjs";
export function mentionsIt() { return require("./held.cjs"); }
test("second", () => {
  try {
    console.log("SAID", require(late).v);
  } catch (error) {
    console.log("SAID", (error as { code?: string }).code);
  }
});
