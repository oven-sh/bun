// Flags: --aot-validate --aot-disable=InlineCalls,EliminateTailRecursion
// The same program where no call is replaced by the body of its callee or by a loop.
import "./a-million-tail-calls-end-in-a-function-that-also-returns-fractions.ts";
