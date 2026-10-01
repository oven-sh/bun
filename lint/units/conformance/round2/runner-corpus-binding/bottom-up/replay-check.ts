// A check module for sweep.ts --check: it reports the diagnostics that the oracle of the instance holds. H is the directory of sweep.ts.
const home = process.env.H;
if (home === undefined) throw new Error("set H to the directory of sweep.ts");
const { replayCheck } = await import(`${home}/runner`);
const { readOracle } = await import(`${home}/runner/oracle`);

export default replayCheck((instance: { oracle?: unknown }) => readOracle(instance.oracle));
