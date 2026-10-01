// A check for --check of sweep.ts: it reports the diagnostics that the oracle of its instance holds, so every instance passes.
import { replayCheck } from "../runner";
import { type Oracle, readOracle } from "../runner/oracle";

export default replayCheck(instance => readOracle(instance.oracle as Oracle));
