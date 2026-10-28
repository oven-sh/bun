import { generated } from "./generated/run-generated";
import { neighbors, sources, textOf } from "./generated/typed-parses-beside-unknown-callers";

generated(
  "a parse by a declared type answers what the plain parse answers",
  Object.entries(sources).flatMap(([name, source]) =>
    Object.entries(neighbors).map(([beside, neighbor]) => ({
      name: `${name}, ${beside}`,
      isAlwaysRun: true,
      isOnlyCompiled: true as const,
      make: () => ({ file: "main.ts", text: textOf(source, neighbor(source.callee)) }),
    })),
  ),
);
