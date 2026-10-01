// A check for --check of sweep.ts: the diagnostics of the oracle, lengths and related information included.
import { replayCheck } from "/tmp/dcx1a/scratch/test/cli/lint/conformance/runner";
import { readOracle } from "/tmp/dcx1a/scratch/test/cli/lint/conformance/runner/oracle";

export default replayCheck(instance => readOracle((instance as any).oracle));
