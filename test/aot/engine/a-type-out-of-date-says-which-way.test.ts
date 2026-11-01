// "The type is not what the result rule gives" says little. Which way it is wrong says how much it matters: a type that is narrower than the rule's claims what nobody has shown.
import { expect } from "bun:test";
import { tempDir } from "harness";
import { join } from "path";
import { describe, test } from "../supported";
import { run, whyNoTestaot } from "./testaot";

const program = (parameter: string, operation: string) => `# FORM: Prepared optimizing
# RUN: verify optimizing

module m0 path="main.js" displayPath="main.js"
function f0 name="stale" parameters=[{type=${parameter}}] results=[{type=undefined}] {
    ${operation}
    Return
}
`;

const cases = [
  ["narrower than", "anything", "v1: number = Call v0", "primitives, any object"],
  ["apart from", "number", "v1: string = Add v0, v0", "primitives, integers"],
];

describe.skipIf(!!whyNoTestaot)("a type out of date", () => {
  test.each(cases)(
    "says that it is %s what the rule gives, and in what the two differ",
    async (way, parameter, operation, parts) => {
      using dir = tempDir("aot-type-out-of-date", { "stale.ir": program(parameter, operation) });
      const { lines } = await run("run", join(String(dir), "stale.ir"));
      expect(
        lines.filter(line => line.includes("TypeOutOfDate")).map(line => line.slice(line.indexOf("value v1"))),
      ).toEqual([`value v1; the type that stands there is ${way} what the rule gives; they differ in ${parts}`]);
    },
  );
});
