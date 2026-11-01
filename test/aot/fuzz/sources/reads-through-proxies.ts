import { answers, program } from "../generators/reads-through-proxies";
import { family } from "../family";

export default family(
  "reads through proxies",
  answers.map(([name, answer]) => ({
    name: `the trap answers ${name}`,
    make: () => program(answer),
  })),
);
