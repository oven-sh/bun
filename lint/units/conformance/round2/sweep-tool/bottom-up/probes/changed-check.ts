// A check for --check of sweep.ts that is wrong for every instance: it reports the diagnostics of the oracle with another text for the first, and one diagnostic where the oracle has none.
import { type Check, replayCheck } from "../repo/test/cli/lint/conformance/runner";
import { type Oracle, readOracle } from "../repo/test/cli/lint/conformance/runner/oracle";

const replay = replayCheck(instance => readOracle(instance.oracle as Oracle));

const check: Check = async (input, signal) => {
  const { diagnostics } = await replay(input, signal);
  if (diagnostics.length === 0) return { diagnostics: [{ category: "error", code: 1, messageText: "Made up." }] };
  return { diagnostics: [{ ...diagnostics[0], messageText: "Changed." }, ...diagnostics.slice(1)] };
};
export default check;
