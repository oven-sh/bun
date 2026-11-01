// Flags: --aot-validate --aot-disable=InlineCalls
// The same program where no call is replaced by the body of its callee.
import "./a-function-that-ends-in-a-call-returns-less-than-its-callee.ts";
