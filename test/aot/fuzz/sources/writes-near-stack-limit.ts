// A list of programs from ../generators/writes-near-stack-limit.ts, which describes them.
import { family } from "../family";
import { files, nameOf, programOf, testCases } from "../generators/writes-near-stack-limit";

export default family(
  "writes near stack limit",
  testCases().map((each, index) => ({
    name: nameOf(each),
    make: () => ({ file: "main.mjs", text: programOf(each), files }),
  })),
);
