// A check for --check of sweep.ts: the diagnostics of the oracle cut down to what the plain format holds of them (no length, no related information).
import { type Check, replayCheck } from "/tmp/dcx1a/scratch/test/cli/lint/conformance/runner";
import { readOracle } from "/tmp/dcx1a/scratch/test/cli/lint/conformance/runner/oracle";

const full = replayCheck(instance => readOracle((instance as any).oracle));
const plain: Check = async (input, signal) => {
  const r = await full(input, signal);
  return {
    diagnostics: r.diagnostics.map(d => ({
      category: d.category,
      code: d.code,
      messageText: d.messageText,
      next: d.next,
      location:
        d.location === undefined
          ? undefined
          : { file: d.location.file, line: d.location.line, character: d.location.character },
    })),
  };
};
export default plain;
