// Flags: --aot-validate --aot-disable=InlineCalls
// The same program where no call is replaced by the body of its callee.
import "./what-comes-back-through-any-kind-of-call-is-less-than-the-callee-returns.ts";
