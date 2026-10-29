import { generated } from "./generated/run-generated";
import { entries, textOf } from "./generated/text-that-comes-at-run-time-changes-what-the-program-holds";

generated(
  "a text that comes at run time changes what the program holds",
  Object.keys(entries).map(entry => ({
    name: entry,
    isAlwaysRun:
      entry === "indirect eval" ||
      entry === "vm.Script" ||
      entry === "eval under a computed name" ||
      entry === "require of a written file",
    groupsMayBeRefused: /^nothing$/,
    make: () => ({ file: "main.mjs", text: textOf(entry) }),
  })),
);
