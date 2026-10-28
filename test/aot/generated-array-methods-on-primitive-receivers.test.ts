import {
  calls,
  methods,
  program,
  receivers,
  stored,
  wasOnceWrong,
} from "./generated/array-methods-on-primitive-receivers";
import { generated, type Generated } from "./generated/run-generated";

const programs: Generated[] = Object.entries(stored).map(([file, text]) => ({
  name: file,
  isAlwaysRun: true,
  wasOnceWrong: true,
  isOnlyCompiled: true,
  make: () => ({ file: `main${file.slice(file.lastIndexOf("."))}`, text: text + "\n" }),
}));

for (const method of Object.keys(methods))
  for (const receiver of Object.keys(receivers))
    for (const call of Object.keys(calls))
      programs.push({
        name: `${method} of ${receiver} by ${call}`,
        isAlwaysRun: call === "call",
        wasOnceWrong: wasOnceWrong(method, receiver),
        isOnlyCompiled: true,
        make: () => program(method, receiver, call),
      });

generated("array methods on primitive receivers", programs);
