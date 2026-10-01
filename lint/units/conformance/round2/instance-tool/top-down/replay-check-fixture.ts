// A check for --check of sweep.ts: it reports the diagnostics that the oracle of its instance holds, so every instance passes.
import { type CorpusInstance, replayCheck } from "../runner";
import { readOracle } from "../runner/oracle";

export default replayCheck(instance => readOracle((instance as CorpusInstance).oracle));
