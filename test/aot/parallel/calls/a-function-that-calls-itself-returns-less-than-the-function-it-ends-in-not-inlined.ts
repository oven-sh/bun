// Flags: --aot-validate --aot-disable=InlineCalls
// The same program where no call is replaced by the body of its callee.
import "./a-function-that-calls-itself-returns-less-than-the-function-it-ends-in.ts";
