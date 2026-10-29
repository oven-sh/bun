import { generated } from "./generated/run-generated";
import { program, sinks, sources } from "./generated/what-the-type-zero-lets-by-reaches-an-int32";

const sourcesOfEveryRun = ["aConstantWrittenMinusZero", "aConstantOfTheWrittenType", "behindIsZero", "inACase", "aFieldOfALiteral", "leftOfAnd"]; // prettier-ignore
const sinksOfEveryRun = ["aParameter", "aResult", "aConstant", "aField", "aSum"];

generated(
  "what the type zero lets by reaches an int32",
  sources.flatMap(source =>
    sinks.map(sink => ({
      name: `${source.name} ${sink.name}.`,
      isAlwaysRun: sourcesOfEveryRun.includes(source.name) && sinksOfEveryRun.includes(sink.name),
      isOnlyCompiled: true as const,
      mayBeRefused: true as const,
      make: () => program(source, sink),
    })),
  ),
);
