import { programs } from "./generated/odd-callables";
import { generated } from "./generated/run-generated";

generated(
  "odd callables at every way to call or construct them",
  programs.map(({ name, text }, index) => ({
    name,
    isAlwaysRun: index % 4 === 0,
    isOnlyCompiled: true as const,
    make: () => ({ file: "main.ts", text }),
  })),
);
