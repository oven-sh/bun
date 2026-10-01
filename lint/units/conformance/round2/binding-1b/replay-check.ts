// usage: RUNNER=<tree>/test/cli/lint/conformance/runner bun <tree>/test/cli/lint/conformance/sweep.ts --check <this file> --no-files [selector ...]
// A check for --check of sweep.ts that reports the diagnostics which the oracle of its instance holds. The sweep hands a check the instance of the corpus, which carries its oracle; this holds for sweep.ts before and after the binding.
const runner = process.env.RUNNER;
if (runner === undefined) throw new Error("RUNNER is not set: the directory test/cli/lint/conformance/runner of the tree");
const { replayCheck } = await import(`${runner}/index.ts`);
const { readOracle } = await import(`${runner}/oracle.ts`);
export default replayCheck((instance: { oracle: unknown }) => readOracle(instance.oracle));
