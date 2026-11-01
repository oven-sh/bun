// Flags: --aot-validate --aot-disable=InlineCalls
// The same program where no call is replaced by the body of its callee, so that every parameter arrives in a register.
import "./calls-on-rare-paths-with-many-arguments-keep-the-parameters.ts";
