import { programs } from "./generated/objects-handed-to-a-coroutine-that-changes-them";
import { generated } from "./generated/run-generated";

// In every run: an async generator whose body stores to, deletes from and redefines what next(), throw() and return() hand it, in a build that checks each native call against the table of built-ins.
const inEveryRun = /^async-(next|throw|return), (add|delete|accessor|push|closure-writes-variable)$/;

generated(
  "an object is handed to a coroutine that changes it",
  programs().map(({ name, file, text }, index) => ({
    name,
    isAlwaysRun: inEveryRun.test(name),
    isOnlyCompiled: true as const,
    flags: inEveryRun.test(name) || index % 2 === 0 ? ["--aot-validate"] : [],
    make: () => ({ file, text }),
  })),
);
