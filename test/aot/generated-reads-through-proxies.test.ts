import { answers, program } from "./generated/reads-through-proxies";
import { generated } from "./generated/run-generated";

generated(
  "reads through proxies",
  answers.map(([name, answer]) => ({
    name: `the trap answers ${name}`,
    isAlwaysRun: name === "the truth" || name === "five",
    make: () => program(answer),
  })),
);
