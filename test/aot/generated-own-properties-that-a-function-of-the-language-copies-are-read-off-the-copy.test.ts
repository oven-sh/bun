import {
  copiers,
  pairsOfRoads,
  readers,
  sources,
  stands,
  textOf,
} from "./generated/own-properties-copied-by-functions-of-the-language";
import { generated } from "./generated/run-generated";

generated(
  "a function of the language copies the own properties of a value, and the program reads the copy",
  Object.keys(sources).flatMap(source =>
    Object.keys(copiers).flatMap(copier =>
      pairsOfRoads(copier).flatMap(([ofSource, ofOperand]) =>
        stands.flatMap(stand =>
          readers.map(([reader], index) => ({
            name: `${source}, ${copier}; what is copied: ${ofSource}${copiers[copier].inner ? `; what the first call answers: ${ofOperand}` : ""}; ${stand}: ${reader}`,
            isAlwaysRun:
              stand === "in a function" &&
              ofSource === "a variable" &&
              ofOperand === "in the call" &&
              /^(defineProperties on a literal|a spread)$/.test(copier) &&
              /^(a literal with name|the own keys)$/.test(reader),
            isOnlyCompiled: true as const,
            make: () => ({ file: "main.mjs", text: textOf(source, copier, ofSource, ofOperand, stand, index) }),
          })),
        ),
      ),
    ),
  ),
);
