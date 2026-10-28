import { generated } from "./generated/run-generated";
import { files, nameOf, programOf, testCases } from "./generated/writes-where-the-stack-ends";

const onceWrong = [
  "require of a file | finally | ",
  "require of a file | catch | ",
  "structuredClone | cleared ahead of the call | ",
  "JSON.stringify | cleared ahead of the call | ",
  "a number in an object | behind a try that has ended | ",
  "a boolean in an object | behind a try that has ended | ",
  "a date out of seven numbers | behind a try that has ended | ",
];

generated(
  "whoever catches the error at the end of the stack finds what the function wrote taken back",
  testCases().map((each, index) => ({
    name: nameOf(each),
    isAlwaysRun: index % 4 === 0,
    wasOnceWrong: index < testCases().length / 4 && onceWrong.some(name => nameOf(each).startsWith(name)),
    isOnlyCompiled: true as const,
    make: () => ({ file: "main.mjs", text: programOf(each), files }),
  })),
);
