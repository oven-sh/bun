// A check for --check of sweep.ts that replays the oracle and is wrong for three instances, each in another way.
import type { Check, Diagnostic } from "../runner";
import replay from "./replay-check-fixture";

const wrong: Record<string, (diagnostics: Diagnostic[]) => Diagnostic[]> = {
  // Another text for the first diagnostic: line 1 of the baseline is not the oracle's.
  "castingTuple.ts": ([first, ...rest]) => [{ ...first, messageText: "Changed." }, ...rest],
  // Nothing where the oracle has errors.
  "ArrowFunctionExpression1.ts": () => [],
  // A diagnostic where the oracle has none.
  "2dArrays.ts": () => [{ category: "error", code: 1, messageText: "Made up." }],
};

const check: Check = async (input, signal) => {
  const { diagnostics } = await replay(input, signal);
  return { diagnostics: wrong[input.instance.name]?.(diagnostics) ?? diagnostics };
};
export default check;
