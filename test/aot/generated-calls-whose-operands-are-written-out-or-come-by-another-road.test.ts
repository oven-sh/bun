import { readers, roads, shapes, stands, textOf } from "./generated/calls-whose-operands-are-written-out";
import { generated } from "./generated/run-generated";

generated(
  "a call of a function of the language has its operand written out, or the operand comes by another road",
  Object.entries(shapes).flatMap(([shape, { choices }]) =>
    choices.flatMap((choice, index) =>
      roads.flatMap(road =>
        stands.flatMap(stand =>
          readers.map(([reader], number) => ({
            name: `${shape}: ${choice}; ${road}; ${stand}: ${reader}`,
            isAlwaysRun:
              road === "in the call" && stand === "in a function" && (reader === "itself" || reader === "the own keys"),
            isOnlyCompiled: true as const,
            keepsItsText: true as const,
            make: () => ({ file: "main.mjs", text: textOf(shape, index, road, stand, number) }),
          })),
        ),
      ),
    ),
  ),
);
