import { family } from "../family";
import { files, nameOf, programOf, testCases } from "../generators/writes-where-the-stack-ends";

export default family(
  "whoever catches the error at the end of the stack finds what the function wrote taken back",
  testCases().map((each, index) => ({
    name: nameOf(each),
    make: () => ({ file: "main.mjs", text: programOf(each), files }),
  })),
);
